import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import { PositionEvalSchema, type PositionEval } from "../domain";
import type { AnalyzeOptions, EngineAnalyzer } from "./index";

/** Thrown when the engine binary is not configured, missing or not executable. */
export class EngineNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineNotFoundError";
  }
}

/** Thrown when the engine misbehaves: crash, timeout, bad output. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

/** Minimal process seam, so tests can plug in a fake UCI engine. */
export interface UciProcess {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: (reason: string) => void): void;
  kill(): void;
}

export type UciSpawn = (path: string) => UciProcess;

/**
 * Real process: child_process.spawn with an args array and no shell.
 * Rejects (via onExit) with EngineNotFound-style reasons when the binary cannot start.
 */
export const spawnUci: UciSpawn = (path) => {
  const child = nodeSpawn(path, [], { stdio: ["pipe", "pipe", "ignore"], shell: false });
  const lineCbs: ((l: string) => void)[] = [];
  const exitCbs: ((r: string) => void)[] = [];
  let exited = false;
  const fireExit = (reason: string) => {
    if (exited) return;
    exited = true;
    exitCbs.forEach((cb) => cb(reason));
  };
  createInterface({ input: child.stdout }).on("line", (l) => lineCbs.forEach((cb) => cb(l)));
  child.on("error", (e: NodeJS.ErrnoException) => fireExit(`spawn:${e.code ?? "ERR"}:${e.message}`));
  child.on("exit", (code, sig) => fireExit(`exit:${sig ?? code}`));
  child.stdin.on("error", () => {}); // EPIPE after the engine died is reported through onExit
  return {
    send: (line) => {
      if (!exited) child.stdin.write(`${line}\n`);
    },
    onLine: (cb) => void lineCbs.push(cb),
    onExit: (cb) => void exitCbs.push(cb),
    kill: () => void child.kill(),
  };
};

export interface UciEngineOptions {
  /** Path to the Stockfish (or other UCI) binary. Defaults to process.env.STOCKFISH_PATH. */
  path?: string | undefined;
  spawn?: UciSpawn;
  /** Default search depth when analyze() gets no depth or movetime. Default 12. */
  defaultDepth?: number;
  /** Threads UCI option. Default 1. */
  threads?: number;
  /** Hash UCI option in MB. Default 64. */
  hashMb?: number;
  /** Time allowed for the handshake. Default 10s. */
  startupTimeoutMs?: number;
  /** Extra time allowed on top of movetime for one analysis. Default 30s (also the cap for depth-only searches). */
  searchTimeoutMs?: number;
}

// Piece placement, side to move, castling, en passant, optional clocks. No whitespace/newlines beyond single spaces:
// this also stops UCI command injection through a crafted FEN.
const FEN_RE = /^[1-8pnbrqkPNBRQK/]+ [wb] (?:-|[KQkq]{1,4}) (?:-|[a-h][36])(?: \d+ \d+)?$/;

interface Pending {
  fenWhiteToMove: boolean;
  best: { depth: number; cp?: number; mate?: number; pv?: string } | undefined;
  resolve: (e: PositionEval) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** UCI wrapper implementing EngineAnalyzer. Evaluations are from White's point of view. */
export class UciEngine implements EngineAnalyzer {
  private proc: UciProcess | undefined;
  private starting: Promise<UciProcess> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: Pending | undefined;
  private readonly cache = new Map<string, PositionEval>();
  private engineName: string | undefined;
  private closed = false;

  constructor(private readonly opts: UciEngineOptions = {}) {}

  /** Engine name from the "id name" line, available after the first analysis. */
  get name(): string | undefined {
    return this.engineName;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  analyze(fen: string, options: AnalyzeOptions = {}): Promise<PositionEval> {
    if (this.closed) return Promise.reject(new EngineError("Engine is closed."));
    if (!FEN_RE.test(fen)) return Promise.reject(new EngineError(`Invalid FEN: ${JSON.stringify(fen)}`));
    const depth = options.depth ?? (options.movetimeMs ? undefined : (this.opts.defaultDepth ?? 12));
    const key = `${fen.split(" ").slice(0, 4).join(" ")}|${depth !== undefined ? `d${depth}` : ""}|${
      options.movetimeMs ? `t${options.movetimeMs}` : ""
    }`;
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);

    const run = this.queue.then(() => this.search(fen, depth, options.movetimeMs, key));
    this.queue = run.catch(() => undefined); // keep the queue alive after a failure
    return run;
  }

  async close(): Promise<void> {
    this.closed = true;
    const proc = this.proc ?? (await this.starting?.catch(() => undefined));
    this.proc = undefined;
    this.starting = undefined;
    if (proc) {
      try {
        proc.send("quit");
      } catch {
        /* already gone */
      }
      setTimeout(() => proc.kill(), 500).unref();
    }
  }

  private start(): Promise<UciProcess> {
    this.starting ??= this.doStart().catch((e: unknown) => {
      this.starting = undefined;
      throw e;
    });
    return this.starting;
  }

  private doStart(): Promise<UciProcess> {
    const path = this.opts.path ?? process.env["STOCKFISH_PATH"];
    if (!path) {
      throw new EngineNotFoundError(
        "Stockfish is not configured. Install Stockfish and set STOCKFISH_PATH to its binary (see .env.example).",
      );
    }
    const spawnFn = this.opts.spawn ?? spawnUci;
    const proc = spawnFn(path);
    this.proc = proc;

    return new Promise<UciProcess>((resolve, reject) => {
      let stage: "uci" | "ready" | "running" = "uci";
      const timer = setTimeout(() => {
        proc.kill();
        reject(new EngineError(`Engine at ${path} did not answer the UCI handshake in time.`));
      }, this.opts.startupTimeoutMs ?? 10_000);
      const fail = (e: Error) => {
        clearTimeout(timer);
        reject(e);
      };

      proc.onExit((reason) => {
        const wasRunning = stage === "running";
        this.proc = undefined;
        this.starting = undefined;
        if (!wasRunning) {
          fail(
            reason.startsWith("spawn:ENOENT") || reason.startsWith("spawn:EACCES")
              ? new EngineNotFoundError(
                  `Cannot run the engine at STOCKFISH_PATH=${path} (${reason.split(":")[1]}). Check the path and permissions.`,
                )
              : new EngineError(`Engine at ${path} stopped during startup (${reason}).`),
          );
        }
        this.failPending(new EngineError(`Engine process ended unexpectedly (${reason}).`));
      });

      proc.onLine((line) => {
        if (stage === "running") return this.onLine(line);
        if (line.startsWith("id name ")) this.engineName = line.slice(8).trim();
        else if (line.trim() === "uciok" && stage === "uci") {
          stage = "ready";
          proc.send(`setoption name Threads value ${this.opts.threads ?? 1}`);
          proc.send(`setoption name Hash value ${this.opts.hashMb ?? 64}`);
          proc.send("isready");
        } else if (line.trim() === "readyok" && stage === "ready") {
          stage = "running";
          clearTimeout(timer);
          resolve(proc);
        }
      });
      proc.send("uci");
    });
  }

  private async search(
    fen: string,
    depth: number | undefined,
    movetimeMs: number | undefined,
    key: string,
  ): Promise<PositionEval> {
    const proc = await this.start();
    return new Promise<PositionEval>((resolve, reject) => {
      const budget = (movetimeMs ?? 0) + (this.opts.searchTimeoutMs ?? 30_000);
      const timer = setTimeout(() => {
        this.failPending(new EngineError(`Engine did not finish analysing within ${budget} ms.`));
        proc.kill();
      }, budget);
      this.pending = {
        fenWhiteToMove: fen.split(" ")[1] === "w",
        best: undefined,
        resolve: (e) => {
          clearTimeout(timer);
          this.cache.set(key, e);
          resolve(e);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      };
      proc.send(`position fen ${fen}`);
      const limits = [depth !== undefined ? `depth ${depth}` : "", movetimeMs ? `movetime ${movetimeMs}` : ""]
        .filter(Boolean)
        .join(" ");
      proc.send(`go ${limits}`);
    });
  }

  private failPending(err: Error): void {
    const p = this.pending;
    this.pending = undefined;
    p?.reject(err);
  }

  private onLine(line: string): void {
    const p = this.pending;
    if (!p) return;
    if (line.startsWith("info ")) {
      const info = parseInfo(line);
      if (info) p.best = info;
      return;
    }
    if (line.startsWith("bestmove")) {
      this.pending = undefined;
      const move = line.split(/\s+/)[1];
      const best = p.best;
      if (!best) return p.reject(new EngineError("Engine returned a best move without any evaluation."));
      const sign = p.fenWhiteToMove ? 1 : -1; // UCI scores are from the side to move
      const evalFields = best.mate !== undefined ? { mate: best.mate * sign } : { evalCp: (best.cp ?? 0) * sign };
      const parsed = PositionEvalSchema.safeParse({
        ...evalFields,
        depth: Math.max(1, best.depth),
        ...(move && move !== "(none)" && move !== "0000" ? { bestMoveUci: move } : {}),
      });
      if (!parsed.success) return p.reject(new EngineError(`Unusable engine output: ${line}`));
      p.resolve(parsed.data);
    }
  }
}

/** Parse "info depth 12 ... score cp 34 ... pv e2e4 e7e5". Ignores bound scores and multipv > 1. */
export function parseInfo(line: string): { depth: number; cp?: number; mate?: number; pv?: string } | undefined {
  const t = line.split(/\s+/);
  const di = t.indexOf("depth");
  const si = t.indexOf("score");
  if (di < 0 || si < 0) return undefined;
  const mpi = t.indexOf("multipv");
  if (mpi >= 0 && t[mpi + 1] !== "1") return undefined;
  const kind = t[si + 1];
  const value = Number(t[si + 2]);
  const depth = Number(t[di + 1]);
  if (!Number.isFinite(value) || !Number.isFinite(depth)) return undefined;
  const bound = t[si + 3];
  if (bound === "lowerbound" || bound === "upperbound") return undefined;
  const pvi = t.indexOf("pv");
  const pv = pvi >= 0 ? t[pvi + 1] : undefined;
  if (kind === "cp") return { depth, cp: Math.round(value), ...(pv ? { pv } : {}) };
  if (kind === "mate") return { depth, mate: Math.round(value), ...(pv ? { pv } : {}) };
  return undefined;
}
