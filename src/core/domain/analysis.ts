import { z } from "zod";
import { GameSchema, MoveSchema } from "./game";

export const MoveClassSchema = z.enum(["best", "good", "inaccuracy", "mistake", "blunder"]);
export type MoveClass = z.infer<typeof MoveClassSchema>;

export const GamePhaseSchema = z.enum(["opening", "middlegame", "endgame"]);
export type GamePhase = z.infer<typeof GamePhaseSchema>;

/** Exactly one of evalCp or mate is set. Evaluations are from White's point of view. */
const evalFields = {
  evalCp: z.number().int().optional(),
  /** Moves to mate; positive means White mates, negative means Black mates. */
  mate: z.number().int().optional(),
};
const hasExactlyOneEval = (v: { evalCp?: number | undefined; mate?: number | undefined }) =>
  (v.evalCp === undefined) !== (v.mate === undefined);
const evalMessage = { message: "exactly one of evalCp or mate must be set" };

export const PositionEvalSchema = z
  .object({
    ...evalFields,
    depth: z.number().int().positive(),
    bestMoveUci: z.string().min(4).max(5).optional(),
  })
  .refine(hasExactlyOneEval, evalMessage);
export type PositionEval = z.infer<typeof PositionEvalSchema>;

export const AnalyzedMoveSchema = MoveSchema.extend({
  ...evalFields,
  /** Mover's winning chances after the move, 0 to 100. */
  winPct: z.number().min(0).max(100),
  /** Mover's winning chances before the move, 0 to 100. */
  winPctBefore: z.number().min(0).max(100).optional(),
  class: MoveClassSchema,
  phase: GamePhaseSchema.optional(),
  bestMoveUci: z.string().min(4).max(5).optional(),
}).refine(hasExactlyOneEval, evalMessage);
export type AnalyzedMove = z.infer<typeof AnalyzedMoveSchema>;

export const AnalyzedGameSchema = z.object({
  game: GameSchema.omit({ moves: true }),
  moves: z.array(AnalyzedMoveSchema),
  engine: z.object({
    name: z.string().optional(),
    depth: z.number().int().positive(),
  }),
  /** ISO 8601 date-time. */
  analyzedAt: z.iso.datetime(),
});
export type AnalyzedGame = z.infer<typeof AnalyzedGameSchema>;
