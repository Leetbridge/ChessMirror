import { z } from "zod";

/**
 * A Lichess puzzle (CC0 database). `fen` is the position BEFORE the opponent's first move;
 * `moves[0]` is that opponent move, `moves[1..]` is the solution (UCI).
 */
export const PuzzleSchema = z.object({
  id: z.string().min(1),
  fen: z.string().min(1),
  moves: z.array(z.string().min(4).max(5)).min(2),
  rating: z.number().int().positive(),
  /** Lichess popularity, -100 (worst) to 100 (best). */
  popularity: z.number().int().min(-100).max(100),
  nbPlays: z.number().int().nonnegative(),
  themes: z.array(z.string().min(1)),
});
export type Puzzle = z.infer<typeof PuzzleSchema>;
