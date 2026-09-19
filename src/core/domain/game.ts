import { z } from "zod";

export const ColorSchema = z.enum(["white", "black"]);
export type Color = z.infer<typeof ColorSchema>;

export const GameSourceIdSchema = z.enum(["lichess", "chesscom", "pgn"]);
export type GameSourceId = z.infer<typeof GameSourceIdSchema>;

export const GameResultSchema = z.enum(["white", "black", "draw", "unknown"]);
export type GameResult = z.infer<typeof GameResultSchema>;

export const PlayerSchema = z.object({
  name: z.string().min(1),
  rating: z.number().int().positive().optional(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const TimeControlSchema = z.object({
  /** Initial time in seconds. */
  initialSec: z.number().nonnegative(),
  /** Increment per move in seconds. */
  incrementSec: z.number().nonnegative(),
});
export type TimeControl = z.infer<typeof TimeControlSchema>;

export const MoveSchema = z.object({
  /** 1-based half-move index (white's first move is ply 1). */
  ply: z.number().int().positive(),
  san: z.string().min(1),
  uci: z.string().min(4).max(5),
  /** Time left on the mover's clock after the move, when the source provides it. */
  clockMs: z.number().int().nonnegative().optional(),
});
export type Move = z.infer<typeof MoveSchema>;

export const GameSchema = z.object({
  /** Stable id, unique across sources, e.g. "lichess:abc123". */
  id: z.string().min(1),
  source: GameSourceIdSchema,
  url: z.url().optional(),
  /** ISO 8601 date-time. */
  playedAt: z.iso.datetime(),
  white: PlayerSchema,
  black: PlayerSchema,
  /** Which side the analyzed user played. */
  userColor: ColorSchema,
  result: GameResultSchema,
  termination: z.string().optional(),
  timeControl: TimeControlSchema.optional(),
  moves: z.array(MoveSchema),
  pgn: z.string().optional(),
});
export type Game = z.infer<typeof GameSchema>;
