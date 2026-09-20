// Downloads the Lichess puzzle database (CC0), stream-decompresses it, and indexes a filtered subset
// into SQLite (docs/adr/0004-puzzle-source.md). Run through tsx (see package.json) so the core
// TypeScript modules can be imported. Env: PUZZLES_DATABASE_PATH (default ./data/puzzles.db).
//
// Usage: npm run setup:puzzles -- [--limit N] [--per-theme N] [--max-total N]
//        [--rating-min N] [--rating-max N] [--timeout-min N] [--max-download-mb N] [--force]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { parseArgs } from "node:util";
import zlib from "node:zlib";
import { buildPuzzleIndex, DEFAULT_INGEST, guardedLines, isAllowedPuzzleUrl, zstdExitOk } from "../src/core/puzzles/index.ts";
import { createSqlitePuzzleStore } from "../src/core/store/index.ts";

const SOURCE_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const USER_AGENT = "chessmirror/0.0 (open-source chess coach; setup:puzzles)";

const { values } = parseArgs({
  options: {
    limit: { type: "string" },
    "per-theme": { type: "string" },
    "max-total": { type: "string" },
    "rating-min": { type: "string" },
    "rating-max": { type: "string" },
    "timeout-min": { type: "string", default: "30" },
    "max-download-mb": { type: "string", default: "600" },
    "max-decompressed-mb": { type: "string", default: "4096" },
    force: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(
    "Options: --limit N (stop after N source rows; aborts the download early), --per-theme N (default " +
      `${DEFAULT_INGEST.perTheme}), --max-total N (default ${DEFAULT_INGEST.maxTotal}), --rating-min N (${DEFAULT_INGEST.ratingMin}), ` +
      `--rating-max N (${DEFAULT_INGEST.ratingMax}), --timeout-min N (30), --max-download-mb N (600), --max-decompressed-mb N (4096), --force`,
  );
  process.exit(0);
}

function intArg(name, fallback) {
  const raw = values[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer, got "${raw}"`);
  return n;
}

const limit = intArg("limit", undefined);
const options = {
  ratingMin: intArg("rating-min", DEFAULT_INGEST.ratingMin),
  ratingMax: intArg("rating-max", DEFAULT_INGEST.ratingMax),
  perTheme: intArg("per-theme", DEFAULT_INGEST.perTheme),
  maxTotal: intArg("max-total", DEFAULT_INGEST.maxTotal),
  maxRows: limit,
};
const timeoutMs = intArg("timeout-min", 30) * 60_000;
const maxBytes = intArg("max-download-mb", 600) * 1024 * 1024;
const maxDecompressedBytes = intArg("max-decompressed-mb", 4096) * 1024 * 1024;

const out = resolve(process.env.PUZZLES_DATABASE_PATH ?? "./data/puzzles.db");
const tmp = `${out}.tmp`;

if (existsSync(out) && !values.force) {
  console.log(`${out} already exists. Use --force to rebuild.`);
  process.exit(0);
}

/** Prefer the system zstd binary; fall back to node:zlib zstd (Node >= 22.15 / 23.8, absent on Node 20). */
function hasSystemZstd() {
  const r = spawn("zstd", ["--version"], { stdio: "ignore" });
  return new Promise((res) => {
    r.on("error", () => res(false));
    r.on("close", (code) => res(code === 0));
  });
}

function removeDb(path) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
}

async function main() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error(`Timed out after ${timeoutMs / 60_000} minutes`)), timeoutMs);

  const systemZstd = await hasSystemZstd();
  if (!systemZstd && typeof zlib.createZstdDecompress !== "function") {
    throw new Error(
      "No zstd decompressor available. Install the zstd binary (macOS: brew install zstd; Debian/Ubuntu: apt install zstd) " +
        "or use Node >= 22.15 (node:zlib zstd).",
    );
  }

  console.log(`Downloading ${SOURCE_URL}${limit ? ` (stopping after ${limit} rows)` : ""}`);
  // redirect: "error" refuses any redirect; the URL check after fetch is defense in depth.
  const res = await fetch(SOURCE_URL, { signal: abort.signal, redirect: "error", headers: { "User-Agent": USER_AGENT } });
  if (!isAllowedPuzzleUrl(res.url || SOURCE_URL)) throw new Error(`Unexpected download host: ${res.url}`);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new Error(`File is ${(declared / 1048576).toFixed(0)} MB, above --max-download-mb (${maxBytes / 1048576}). Aborting.`);
  }

  let downloaded = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      downloaded += chunk.length;
      if (downloaded > maxBytes) cb(new Error("Download exceeded --max-download-mb"));
      else cb(null, chunk);
    },
  });
  let streamError;
  const body = Readable.fromWeb(res.body).on("error", (e) => counter.destroy(e)).pipe(counter);
  body.on("error", (e) => {
    streamError = e;
    killChild();
  });

  let lineSource;
  let killedByUs = false;
  const killChild = () => {
    killedByUs = true;
    child?.kill("SIGKILL");
  };
  let child;
  let childDone = Promise.resolve();
  if (systemZstd) {
    child = spawn("zstd", ["-dc"], { stdio: ["pipe", "pipe", limit ? "ignore" : "inherit"] });
    childDone = new Promise((resolveDone, rejectDone) => {
      child.on("error", rejectDone);
      child.on("close", (code, signal) =>
        zstdExitOk({ code, signal, killedByUs, limited: limit !== undefined })
          ? resolveDone()
          : rejectDone(new Error(`zstd exited abnormally (code ${code}, signal ${signal})`)),
      );
    });
    child.stdin.on("error", () => {}); // EPIPE after early stop
    body.pipe(child.stdin);
    lineSource = child.stdout;
  } else {
    const dec = zlib.createZstdDecompress();
    dec.on("error", (e) => {
      streamError = e;
      body.destroy();
    });
    body.pipe(dec);
    lineSource = dec;
  }

  removeDb(tmp);
  mkdirSync(dirname(out), { recursive: true });
  const store = createSqlitePuzzleStore(tmp);
  const started = Date.now();
  let stats;
  try {
    // Caps on decompressed size and line length protect against a zstd bomb or a newline-less stream.
    const lines = guardedLines(lineSource, { maxBytes: maxDecompressedBytes, maxLineBytes: 64 * 1024 });
    stats = await buildPuzzleIndex(lines, store, options);
    if (streamError) throw streamError;
    // Full run: a truncated or corrupt archive makes zstd exit non-zero. Limited run: we stop early on purpose.
    if (!limit) await childDone;
  } catch (e) {
    store.close();
    removeDb(tmp);
    throw e;
  } finally {
    clearTimeout(timer);
    body.destroy();
    killChild();
  }
  store.close();
  renameSync(tmp, out);
  rmSync(`${tmp}-wal`, { force: true });
  rmSync(`${tmp}-shm`, { force: true });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `Done in ${secs}s. Downloaded ~${(downloaded / 1048576).toFixed(1)} MB (compressed). ` +
      `Rows read ${stats.rowsRead}, out of range ${stats.outOfRange}, malformed ${stats.malformed}, ` +
      `themes ${stats.themes}, puzzles written ${stats.written}. Index: ${out}`,
  );
}

main().catch((e) => {
  console.error(`setup:puzzles failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
