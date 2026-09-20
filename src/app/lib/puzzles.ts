import type { AnalyzedGame, Plan } from "../../core/domain";
import { getPuzzlesByTheme } from "../../core/puzzles";
import type { PuzzleStore } from "../../core/store";
import type { PuzzleRef } from "./types";

export const PUZZLES_PER_DRILL = 10;
export const RATING_WINDOW = 300;

/** Median of the user's own ratings across the analyzed games, or undefined when none is known. */
export function estimateRating(games: readonly AnalyzedGame[]): number | undefined {
  const ratings = games
    .map((a) => (a.game.userColor === "white" ? a.game.white.rating : a.game.black.rating))
    .filter((r): r is number => r !== undefined)
    .sort((a, b) => a - b);
  return ratings[Math.floor(ratings.length / 2)];
}

/**
 * Real puzzles per chess drill, using exactly the drill's puzzleThemes. Rating is limited to
 * +-RATING_WINDOW around the estimate; if that leaves nothing, the range is widened to all ratings.
 */
export function attachPuzzles(plan: Plan, store: PuzzleStore, rating: number | undefined): Record<string, PuzzleRef[]> {
  const out: Record<string, PuzzleRef[]> = {};
  for (const drill of plan.chessDrills) {
    const themes = drill.puzzleThemes ?? [];
    if (themes.length === 0) continue;
    const ranged =
      rating === undefined
        ? []
        : getPuzzlesByTheme(store, themes, {
            ratingRange: { min: Math.max(0, rating - RATING_WINDOW), max: rating + RATING_WINDOW },
            limit: PUZZLES_PER_DRILL,
          });
    const found = ranged.length > 0 ? ranged : getPuzzlesByTheme(store, themes, { limit: PUZZLES_PER_DRILL });
    if (found.length > 0) {
      out[drill.id] = found.map((p) => ({ id: p.id, fen: p.fen, moves: p.moves, rating: p.rating, themes: p.themes }));
    }
  }
  return out;
}
