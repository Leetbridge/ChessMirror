/** Pure safety helpers for the puzzle download pipeline (used by scripts/setup-puzzles.mjs). */

export const ALLOWED_PUZZLE_URL_PREFIX = "https://database.lichess.org/";

/** True only for https URLs on the pinned Lichess database host (checked after redirects). */
export function isAllowedPuzzleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "database.lichess.org" && u.port === "";
  } catch {
    return false;
  }
}

export interface ZstdExit {
  code: number | null;
  signal: string | null;
  /** We sent the kill ourselves (early stop or error cleanup). */
  killedByUs: boolean;
  /** Run was bounded with --limit, so stopping before the end is expected. */
  limited: boolean;
}

/** Whether a finished zstd child counts as success. A foreign signal (OOM killer, crash) is a failure. */
export function zstdExitOk(e: ZstdExit): boolean {
  if (e.code === 0) return true;
  return e.signal !== null && (e.killedByUs || e.limited);
}

export interface LineGuardOptions {
  /** Abort when more than this many decompressed bytes were seen. */
  maxBytes: number;
  /** Abort when a single line exceeds this many bytes (newline-less stream). */
  maxLineBytes: number;
}

/**
 * Splits a byte/string stream into lines while enforcing total-size and line-length caps,
 * so a zstd bomb or a stream without newlines cannot exhaust memory.
 */
export async function* guardedLines(
  source: AsyncIterable<Uint8Array | string>,
  opts: LineGuardOptions,
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let pending = "";
  for await (const chunk of source) {
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    total += bytes;
    if (total > opts.maxBytes) throw new Error(`Decompressed data exceeded ${opts.maxBytes} bytes; aborting.`);
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let nl = pending.indexOf("\n");
    while (nl !== -1) {
      const line = pending.slice(0, nl);
      if (line.length > opts.maxLineBytes) throw new Error("Line longer than the allowed maximum; aborting.");
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
      pending = pending.slice(nl + 1);
      nl = pending.indexOf("\n");
    }
    if (pending.length > opts.maxLineBytes) throw new Error("Line longer than the allowed maximum; aborting.");
  }
  pending += decoder.decode();
  if (pending !== "") yield pending;
}
