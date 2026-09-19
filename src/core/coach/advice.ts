import { z } from "zod";

export const RefSchema = z.object({
  gameId: z.string().min(1),
  ply: z.number().int().positive(),
});

export const FindingAdviceSchema = z.object({
  findingId: z.string().min(1),
  headline: z.string().min(1).max(120),
  /** Hypothesis wording, cites the player's own games/counts/times. */
  explanation: z.string().min(1).max(1200),
  /** One concrete next step tied to the finding's drills. */
  whatToDo: z.string().min(1).max(800),
  /** Evidence the text refers to. Must be a subset of the supplied evidence. */
  citedRefs: z.array(RefSchema).min(1),
  /** Every move (SAN or UCI) mentioned in the text. Must come from engine data. */
  mentionedMoves: z.array(z.string()),
});
export type FindingAdvice = z.infer<typeof FindingAdviceSchema>;

export const CoachAdviceSchema = z.object({
  summary: z.string().min(1).max(1200),
  findings: z.array(FindingAdviceSchema),
});
export type CoachAdvice = z.infer<typeof CoachAdviceSchema>;
