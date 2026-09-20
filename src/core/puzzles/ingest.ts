import type { Puzzle } from "../domain";
import type { PuzzleStore } from "../store";
import { isPuzzleCsvHeader, parsePuzzleLine } from "./csv";

export interface IngestOptions {
  ratingMin: number;
  ratingMax: number;
  /** Keep the top N puzzles per theme by popularity, then plays. */
  perTheme: number;
  /** Hard cap on rows written. Selection is round-robin by rank across themes. */
  maxTotal: number;
  /** Stop reading after this many source data rows (smoke tests / bounded runs). */
  maxRows?: number;
}

export const DEFAULT_INGEST: IngestOptions = { ratingMin: 600, ratingMax: 2600, perTheme: 2000, maxTotal: 150_000 };

export interface IngestStats {
  rowsRead: number;
  malformed: number;
  outOfRange: number;
  written: number;
  themes: number;
}

/** Best first: popularity desc, nbPlays desc, id asc (deterministic). */
function better(a: Puzzle, b: Puzzle): number {
  return b.popularity - a.popularity || b.nbPlays - a.nbPlays || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Streams CSV lines, keeps a bounded top-N per theme (memory is O(themes * perTheme)), then writes
 * the union to the store. Throws if the first line is not the expected header (format drift).
 */
export async function buildPuzzleIndex(
  lines: AsyncIterable<string> | Iterable<string>,
  store: PuzzleStore,
  options: Partial<IngestOptions> = {},
): Promise<IngestStats> {
  const o = { ...DEFAULT_INGEST, ...options };
  const stats: IngestStats = { rowsRead: 0, malformed: 0, outOfRange: 0, written: 0, themes: 0 };
  const byTheme = new Map<string, Puzzle[]>();
  let first = true;

  for await (const line of lines) {
    if (first) {
      first = false;
      if (!isPuzzleCsvHeader(line)) throw new Error("Unexpected puzzle CSV header; the Lichess format may have changed.");
      continue;
    }
    if (line === "") continue;
    if (o.maxRows !== undefined && stats.rowsRead >= o.maxRows) break;
    stats.rowsRead++;
    const p = parsePuzzleLine(line);
    if (!p) {
      stats.malformed++;
      continue;
    }
    if (p.rating < o.ratingMin || p.rating > o.ratingMax) {
      stats.outOfRange++;
      continue;
    }
    for (const t of p.themes) {
      let buf = byTheme.get(t);
      if (!buf) byTheme.set(t, (buf = []));
      buf.push(p);
      if (buf.length >= o.perTheme * 2) {
        buf.sort(better);
        buf.length = o.perTheme;
      }
    }
  }

  const ranked = [...byTheme.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, buf]) => buf.sort(better).slice(0, o.perTheme));
  stats.themes = ranked.length;

  const chosen = new Map<string, Puzzle>();
  for (let rank = 0; chosen.size < o.maxTotal; rank++) {
    let any = false;
    for (const list of ranked) {
      const p = list[rank];
      if (!p) continue;
      any = true;
      if (!chosen.has(p.id) && chosen.size < o.maxTotal) chosen.set(p.id, p);
    }
    if (!any) break;
  }

  const all = [...chosen.values()];
  for (let i = 0; i < all.length; i += 5000) store.insertMany(all.slice(i, i + 5000));
  stats.written = all.length;
  return stats;
}
