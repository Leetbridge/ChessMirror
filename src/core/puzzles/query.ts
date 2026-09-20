import { z } from "zod";
import type { Puzzle } from "../domain";
import type { PuzzleStore, ThemeCount } from "../store";

const OptionsSchema = z.object({
  ratingRange: z
    .object({ min: z.number().int().optional(), max: z.number().int().optional() })
    .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, "min must be <= max")
    .optional(),
  limit: z.number().int().min(1).max(200).default(10),
});

export interface GetPuzzlesOptions {
  ratingRange?: { min?: number; max?: number };
  /** 1 to 200, default 10. */
  limit?: number;
}

/**
 * Puzzles matching ANY of the given themes, most popular first. Returns [] when no themes are given.
 * Each puzzle has id, fen (position before the opponent's move), moves (UCI; moves[0] is the
 * opponent's move, the rest is the solution), rating and themes.
 */
export function getPuzzlesByTheme(store: PuzzleStore, themes: readonly string[], options: GetPuzzlesOptions = {}): Puzzle[] {
  const o = OptionsSchema.parse(options);
  if (themes.length === 0) return [];
  return store.find({
    themes: [...new Set(themes)],
    ratingMin: o.ratingRange?.min,
    ratingMax: o.ratingRange?.max,
    limit: o.limit,
  });
}

/** Themes present in the index with their puzzle counts, most common first. */
export function listThemes(store: PuzzleStore): ThemeCount[] {
  return store.listThemes();
}

/** Themes from `wanted` that do not exist in the index. Use to verify plan/ theme names. */
export function findUnknownThemes(store: PuzzleStore, wanted: readonly string[]): string[] {
  const known = new Set(store.listThemes().map((t) => t.theme));
  return [...new Set(wanted)].filter((t) => !known.has(t));
}
