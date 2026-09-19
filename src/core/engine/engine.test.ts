import { describe, expect, it } from "vitest";
import { EngineError, EngineNotFoundError, UciEngine, parseInfo } from "./index";
import type { UciProcess } from "./index";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

/** A scripted fake UCI engine. `reply` decides the lines sent for each "go" command. */
function fakeEngine(reply: (goArgs: string, position: string) => string[], opts: { crashOnGo?: boolean } = {}) {
  const sent: string[] = [];
  let spawnCount = 0;
  const spawn = (): UciProcess => {
    spawnCount++;
    let lineCb: (l: string) => void = () => {};
    let exitCb: (r: string) => void = () => {};
    let position = "";
    const emit = (lines: string[]) => queueMicrotask(() => lines.forEach((l) => lineCb(l)));
    return {
      send(line) {
        sent.push(line);
        if (line === "uci") emit(["id name FakeFish 1", "option name Threads type spin", "uciok"]);
        else if (line === "isready") emit(["readyok"]);
        else if (line.startsWith("position ")) position = line;
        else if (line.startsWith("go")) {
          if (opts.crashOnGo) queueMicrotask(() => exitCb("exit:1"));
          else emit(reply(line.slice(3), position));
        }
      },
      onLine: (cb) => (lineCb = cb),
      onExit: (cb) => (exitCb = cb),
      kill: () => {},
    };
  };
  return { spawn, sent, spawnCount: () => spawnCount, goCount: () => sent.filter((s) => s.startsWith("go")).length };
}

const cp = (n: number) => () => [
  "info depth 3 seldepth 3 multipv 1 score cp 5 nodes 10 pv a2a3",
  `info depth 12 seldepth 15 multipv 1 score cp ${n} nodes 999 pv e2e4 e7e5`,
  "bestmove e2e4 ponder e7e5",
];

describe("parseInfo", () => {
  it("parses cp, mate, depth and pv", () => {
    expect(parseInfo("info depth 12 seldepth 15 multipv 1 score cp -34 nodes 9 pv e2e4 e7e5")).toEqual({
      depth: 12,
      cp: -34,
      pv: "e2e4",
    });
    expect(parseInfo("info depth 9 score mate 3 pv a1a8")).toEqual({ depth: 9, mate: 3, pv: "a1a8" });
  });
  it("ignores bounds, secondary multipv and lines without a score", () => {
    expect(parseInfo("info depth 9 score cp 100 lowerbound pv a1a2")).toBeUndefined();
    expect(parseInfo("info depth 9 multipv 2 score cp 10 pv a1a2")).toBeUndefined();
    expect(parseInfo("info string NNUE evaluation using nn.nnue")).toBeUndefined();
    expect(parseInfo("info currmove e2e4 currmovenumber 1")).toBeUndefined();
  });
});

describe("UciEngine with a fake process", () => {
  it("handshakes, analyzes and reports White-POV evals", async () => {
    const f = fakeEngine(cp(34));
    const engine = new UciEngine({ path: "fake", spawn: f.spawn });
    const r = await engine.analyze(START, { depth: 12 });
    expect(r).toEqual({ evalCp: 34, depth: 12, bestMoveUci: "e2e4" });
    expect(engine.name).toBe("FakeFish 1");
    expect(f.sent).toContain("position fen " + START);
    expect(f.sent).toContain("go depth 12");
    expect(f.sent).toContain("setoption name Threads value 1");
    await engine.close();
    expect(f.sent).toContain("quit");
  });

  it("flips the score when Black is to move (UCI reports side-to-move POV)", async () => {
    const engine = new UciEngine({ path: "fake", spawn: fakeEngine(cp(34)).spawn });
    expect((await engine.analyze(BLACK_TO_MOVE, { depth: 12 })).evalCp).toBe(-34);
    await engine.close();
  });

  it("maps mate scores to White POV and omits bestMove for (none)", async () => {
    const f = fakeEngine(() => ["info depth 20 score mate 2 pv a1a8", "bestmove (none)"]);
    const engine = new UciEngine({ path: "fake", spawn: f.spawn });
    expect(await engine.analyze(BLACK_TO_MOVE, { depth: 20 })).toEqual({ mate: -2, depth: 20 });
    await engine.close();
  });

  it("uses movetime when given and depth otherwise defaults", async () => {
    const f = fakeEngine(cp(0));
    const engine = new UciEngine({ path: "fake", spawn: f.spawn, defaultDepth: 9 });
    await engine.analyze(START, { movetimeMs: 200 });
    await engine.analyze(START);
    expect(f.sent).toContain("go movetime 200");
    expect(f.sent).toContain("go depth 9");
    await engine.close();
  });

  it("caches by FEN (ignoring move counters) and depth", async () => {
    const f = fakeEngine(cp(10));
    const engine = new UciEngine({ path: "fake", spawn: f.spawn });
    await engine.analyze(START, { depth: 10 });
    await engine.analyze(START.replace("0 1", "5 9"), { depth: 10 });
    expect(f.goCount()).toBe(1);
    await engine.analyze(START, { depth: 11 });
    expect(f.goCount()).toBe(2);
    expect(engine.cacheSize).toBe(2);
    await engine.close();
  });

  it("serializes concurrent requests over one process", async () => {
    const f = fakeEngine(cp(1));
    const engine = new UciEngine({ path: "fake", spawn: f.spawn });
    const rs = await Promise.all([START, BLACK_TO_MOVE, START].map((fen, i) => engine.analyze(fen, { depth: 5 + i })));
    expect(rs).toHaveLength(3);
    expect(f.spawnCount()).toBe(1);
    expect(f.goCount()).toBe(3);
    await engine.close();
  });

  it("rejects malformed FENs without sending anything (no command injection)", async () => {
    const f = fakeEngine(cp(1));
    const engine = new UciEngine({ path: "fake", spawn: f.spawn });
    await expect(engine.analyze(START + "\nquit")).rejects.toBeInstanceOf(EngineError);
    await expect(engine.analyze("not a fen")).rejects.toBeInstanceOf(EngineError);
    expect(f.sent).toEqual([]);
  });

  it("rejects when the engine dies mid-analysis, then respawns", async () => {
    const f = fakeEngine(cp(1), { crashOnGo: true });
    const engine = new UciEngine({ path: "fake", spawn: f.spawn });
    await expect(engine.analyze(START, { depth: 5 })).rejects.toThrow(/ended unexpectedly/);
    await expect(engine.analyze(START, { depth: 6 })).rejects.toThrow(/ended unexpectedly/);
    expect(f.spawnCount()).toBe(2);
  });

  it("times out a hung engine", async () => {
    const f = fakeEngine(() => []);
    const engine = new UciEngine({ path: "fake", spawn: f.spawn, searchTimeoutMs: 30 });
    await expect(engine.analyze(START, { depth: 5 })).rejects.toThrow(/did not finish/);
  });

  it("rejects analyze after close", async () => {
    const engine = new UciEngine({ path: "fake", spawn: fakeEngine(cp(1)).spawn });
    await engine.close();
    await expect(engine.analyze(START)).rejects.toBeInstanceOf(EngineError);
  });
});

describe("missing engine", () => {
  it("gives a clear error when STOCKFISH_PATH is not set", async () => {
    const saved = process.env["STOCKFISH_PATH"];
    delete process.env["STOCKFISH_PATH"];
    try {
      await expect(new UciEngine().analyze(START)).rejects.toThrow(/set STOCKFISH_PATH/);
      await expect(new UciEngine().analyze(START)).rejects.toBeInstanceOf(EngineNotFoundError);
    } finally {
      if (saved !== undefined) process.env["STOCKFISH_PATH"] = saved;
    }
  });
  it("gives a clear error when the binary does not exist (real spawn)", async () => {
    const engine = new UciEngine({ path: "/definitely/not/stockfish" });
    const err = await engine.analyze(START).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineNotFoundError);
    expect((err as Error).message).toMatch(/STOCKFISH_PATH=\/definitely\/not\/stockfish/);
  });
});

describe.skipIf(!process.env["STOCKFISH_PATH"])("real Stockfish (integration)", () => {
  it("analyzes real positions", async () => {
    const engine = new UciEngine({ defaultDepth: 10 });
    try {
      const start = await engine.analyze(START, { depth: 10 });
      expect(start.evalCp).toBeDefined();
      expect(Math.abs(start.evalCp ?? 999)).toBeLessThan(100);
      expect(start.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8]/);
      expect(engine.name).toMatch(/stockfish/i);

      // White mates in one with Ra8#.
      const mateW = await engine.analyze("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", { depth: 10 });
      expect(mateW.mate).toBe(1);
      expect(mateW.bestMoveUci).toBe("a1a8");
      // Same idea for Black: result is negative from White's point of view.
      const mateB = await engine.analyze("r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1", { depth: 10 });
      expect(mateB.mate).toBe(-1);
    } finally {
      await engine.close();
    }
  }, 30_000);
});
