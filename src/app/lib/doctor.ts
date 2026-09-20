import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { findStockfish } from "./stockfish-path";

type Env = Record<string, string | undefined>;

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  /** Shown only when the check did not pass. */
  hint?: string;
}

export interface DoctorDeps {
  env: Env;
  platform: NodeJS.Platform;
  nodeVersion: string;
  fileExists: (path: string) => boolean;
  /** Path to Stockfish, or undefined when not found. */
  findStockfish: () => string | undefined;
  /** Ask the binary for "uciok"; resolves to an engine name or an error message. */
  probeEngine: (path: string) => Promise<{ ok: true; name: string } | { ok: false; reason: string }>;
  hasZstd: () => boolean;
}

const STOCKFISH_HINTS: Record<string, string> = {
  darwin: "macOS: brew install stockfish",
  linux: "Debian/Ubuntu: sudo apt install stockfish (other distros: use your package manager)",
  win32: "Windows: download the binary from https://stockfishchess.org/download/ and set STOCKFISH_PATH to the .exe",
};

const ZSTD_HINTS: Record<string, string> = {
  darwin: "macOS: brew install zstd",
  linux: "Debian/Ubuntu: sudo apt install zstd",
  win32: "Windows: install zstd from https://github.com/facebook/zstd/releases and add it to PATH",
};

export async function runDoctor(deps: DoctorDeps): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const major = Number(deps.nodeVersion.split(".")[0]);
  results.push(
    major >= 20
      ? { name: "Node.js", status: "ok", message: `v${deps.nodeVersion}` }
      : { name: "Node.js", status: "fail", message: `v${deps.nodeVersion} (need 20 or newer)`, hint: "Install Node 20+ (see .nvmrc if present)." },
  );

  const stockfish = deps.findStockfish();
  if (!stockfish) {
    results.push({
      name: "Stockfish",
      status: "fail",
      message: "not found on PATH or in common install folders",
      hint: `${STOCKFISH_HINTS[deps.platform] ?? "Install Stockfish from https://stockfishchess.org/download/"}. Then set STOCKFISH_PATH in .env if it is not on your PATH. Stockfish is not bundled (GPL). Not needed for tests or CHESSMIRROR_MOCK=1.`,
    });
  } else {
    const probe = await deps.probeEngine(stockfish);
    results.push(
      probe.ok
        ? { name: "Stockfish", status: "ok", message: `${probe.name} at ${stockfish}${deps.env["STOCKFISH_PATH"]?.trim() ? "" : " (auto-detected)"}` }
        : { name: "Stockfish", status: "fail", message: `found ${stockfish} but it did not answer as a UCI engine (${probe.reason})`, hint: "Check the file is the Stockfish binary and is executable." },
    );
  }

  results.push(
    deps.hasZstd()
      ? { name: "zstd (puzzle setup)", status: "ok", message: "found" }
      : {
          name: "zstd (puzzle setup)",
          status: "warn",
          message: "not found; only needed for `npm run setup:puzzles` on Node 20",
          hint: ZSTD_HINTS[deps.platform] ?? "Install zstd from https://github.com/facebook/zstd",
        },
  );

  results.push(
    deps.fileExists(".env")
      ? { name: ".env", status: "ok", message: "present" }
      : { name: ".env", status: "warn", message: "missing (defaults are used)", hint: "Optional: cp .env.example .env" },
  );

  const puzzlesPath = deps.env["PUZZLES_DATABASE_PATH"]?.trim() || "./data/puzzles.db";
  results.push(
    deps.fileExists(puzzlesPath)
      ? { name: "Puzzle index", status: "ok", message: puzzlesPath }
      : {
          name: "Puzzle index",
          status: "warn",
          message: "not built; plans will show puzzle themes only",
          hint: "Optional: npm run setup:puzzles -- --limit 300000 (small sample, about 16 MB)",
        },
  );

  results.push(
    deps.env["ANTHROPIC_API_KEY"]?.trim()
      ? { name: "LLM", status: "ok", message: "ANTHROPIC_API_KEY set (LLM wording, with template fallback)" }
      : { name: "LLM", status: "ok", message: "no API key: using template explanations (fully working)" },
  );

  return results;
}

export function formatDoctor(results: CheckResult[]): string {
  const icon: Record<CheckStatus, string> = { ok: "[ok]  ", warn: "[warn]", fail: "[FAIL]" };
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${icon[r.status]} ${r.name}: ${r.message}`);
    if (r.status !== "ok" && r.hint) lines.push(`       -> ${r.hint}`);
  }
  const failed = results.some((r) => r.status === "fail");
  lines.push("", failed ? "Some required checks failed. Fix the [FAIL] items above." : "Ready. Run: npm run dev");
  return lines.join("\n");
}

function probeEngine(path: string): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (r: { ok: true; name: string } | { ok: false; reason: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      resolve(r);
    };
    const child = spawn(path, [], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => finish({ ok: false, reason: "timed out" }), 5000);
    child.on("error", (e) => finish({ ok: false, reason: (e as NodeJS.ErrnoException).code ?? "spawn error" }));
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes("uciok")) {
        const name = /^id name (.+)$/m.exec(out)?.[1]?.trim() ?? "UCI engine";
        finish({ ok: true, name });
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.write("uci\n");
  });
}

export function realDoctorDeps(env: Env = process.env): DoctorDeps {
  return {
    env,
    platform: process.platform,
    nodeVersion: process.versions.node,
    fileExists: (p) => existsSync(p),
    findStockfish: () => findStockfish(env),
    probeEngine,
    hasZstd: () => spawnSync("zstd", ["--version"], { stdio: "ignore" }).status === 0,
  };
}
