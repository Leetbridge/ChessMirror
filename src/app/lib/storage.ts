import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CoachEnv } from "../../core/coach";
import { createSqlitePuzzleStore, createSqliteRepository, type PuzzleStore, type Repository } from "../../core/store";
import { createMemoryRepository } from "./memory-repository";
import { ResultSchema, type AnalysisResult } from "./types";

export const DEFAULT_DATABASE_PATH = "./data/chessmirror.db";
export const DEFAULT_PUZZLES_PATH = "./data/puzzles.db";

export type Log = (message: string) => void;
const defaultLog: Log = (m) => console.warn(`[chessmirror] ${m}`);

export function databasePath(env: CoachEnv): string {
  return env["DATABASE_PATH"]?.trim() || DEFAULT_DATABASE_PATH;
}

export function puzzlesPath(env: CoachEnv): string {
  return env["PUZZLES_DATABASE_PATH"]?.trim() || DEFAULT_PUZZLES_PATH;
}

/** SQLite repository at `path`; falls back to in-memory (with a log line) when it cannot be opened. */
export function openRepository(path: string, log: Log = defaultLog): Repository {
  try {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    return createSqliteRepository(path);
  } catch (e) {
    log(
      `Could not open the database at ${path} (${e instanceof Error ? e.message : "unknown error"}); using in-memory storage, results will not persist.`,
    );
    return createMemoryRepository();
  }
}

/** Read-only puzzle store, or undefined when the file is missing or unusable. */
export function openPuzzleStore(path: string, log: Log = defaultLog): PuzzleStore | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return createSqlitePuzzleStore(path, { readonly: true });
  } catch (e) {
    log(`Could not open the puzzle database at ${path} (${e instanceof Error ? e.message : "unknown error"}); skipping puzzles.`);
    return undefined;
  }
}

/** Finished results by job id, so GET works after a restart. Files live next to the database. */
export interface ResultStore {
  save(id: string, result: AnalysisResult): void;
  load(id: string): AnalysisResult | undefined;
}

/** Retention for results/*.json, checked on every save. */
export const MAX_RESULT_FILES = 200;
export const MAX_RESULT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Delete result files older than maxAgeMs, then the oldest ones beyond maxFiles. Best effort. */
export function pruneResults(dir: string, now: number, maxFiles = MAX_RESULT_FILES, maxAgeMs = MAX_RESULT_AGE_MS): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          return [{ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first
    files.forEach((f, i) => {
      if (i >= maxFiles || now - f.mtime > maxAgeMs) {
        try {
          unlinkSync(f.path);
        } catch {
          /* already gone */
        }
      }
    });
  } catch {
    /* directory unreadable: nothing to prune */
  }
}

export function createFileResultStore(
  dbPath: string,
  log: Log = defaultLog,
  limits: { maxFiles?: number; maxAgeMs?: number; now?: () => number } = {},
): ResultStore | undefined {
  if (dbPath === ":memory:") return undefined;
  const dir = join(dirname(dbPath), "results");
  return {
    save(id, result) {
      if (!ID_RE.test(id)) return;
      const tmp = join(dir, `${id}.json.tmp`);
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(tmp, JSON.stringify(result), { mode: 0o600 });
        renameSync(tmp, join(dir, `${id}.json`));
        pruneResults(dir, (limits.now ?? Date.now)(), limits.maxFiles, limits.maxAgeMs);
      } catch (e) {
        try {
          unlinkSync(tmp);
        } catch {
          /* no tmp file to remove */
        }
        log(`Could not persist result ${id}: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    },
    load(id) {
      if (!ID_RE.test(id)) return undefined; // also blocks path traversal
      try {
        return ResultSchema.parse(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")));
      } catch {
        return undefined;
      }
    },
  };
}
