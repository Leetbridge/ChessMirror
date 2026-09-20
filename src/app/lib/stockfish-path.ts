import { accessSync, constants, statSync } from "node:fs";
import { delimiter, posix, win32 } from "node:path";

/** Places package managers commonly install Stockfish, searched after PATH. */
const COMMON_DIRS_POSIX = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/games", "/usr/bin", "/snap/bin"];

type Env = Record<string, string | undefined>;

export interface StockfishLookupDeps {
  platform?: NodeJS.Platform;
  /** True when the path is a regular file we may execute. */
  isExecutable?: (path: string) => boolean;
}

function defaultIsExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the Stockfish binary: an explicit STOCKFISH_PATH always wins (even if it is wrong, so the
 * user sees an error about the path they set). Otherwise search PATH, then common install folders.
 * Only looks at the filesystem; it never runs the binary.
 */
export function findStockfish(env: Env = process.env, deps: StockfishLookupDeps = {}): string | undefined {
  const explicit = env["STOCKFISH_PATH"]?.trim();
  if (explicit) return explicit;

  const platform = deps.platform ?? process.platform;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const names = platform === "win32" ? ["stockfish.exe", "stockfish"] : ["stockfish"];
  const p = platform === "win32" ? win32 : posix;
  // Only absolute PATH entries: "." or "bin" would resolve against the current directory and
  // could run a stockfish file that sits in a cloned or downloaded folder.
  const pathDirs = (env["PATH"] ?? "").split(platform === "win32" ? ";" : delimiter === ";" ? ":" : delimiter).filter((d) => d !== "" && p.isAbsolute(d));
  const dirs = [...pathDirs, ...(platform === "win32" ? [] : COMMON_DIRS_POSIX)];

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = p.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}
