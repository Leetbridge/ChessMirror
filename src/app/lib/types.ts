import { z } from "zod";
import { FindingSchema, PlanSchema } from "../../core/domain";

export const ImportRequestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("lichess"), username: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/) }),
  z.object({ source: z.literal("chesscom"), username: z.string().trim().min(3).max(25).regex(/^[A-Za-z0-9_-]+$/) }),
  z.object({ source: z.literal("pgn"), pgn: z.string().trim().min(10).max(2_000_000) }),
]);
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const ProgressSchema = z.object({
  stage: z.enum(["import", "engine", "habits", "plan"]),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Progress = z.infer<typeof ProgressSchema>;

export const ResultSchema = z.object({
  gamesAnalyzed: z.number().int().nonnegative(),
  findings: z.array(FindingSchema),
  plan: PlanSchema,
});
export type AnalysisResult = z.infer<typeof ResultSchema>;

/** Shape returned by the API for one analysis job. */
export const JobStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("running"), progress: ProgressSchema }),
  z.object({ state: z.literal("done"), result: ResultSchema }),
  z.object({ state: z.literal("error"), message: z.string() }),
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const StartResponseSchema = z.object({ id: z.string().min(1) });

/** The seam between UI/route handlers and the core pipeline. */
export interface AnalysisService {
  start(request: ImportRequest): Promise<{ id: string }>;
  /** Returns undefined for an unknown job id. */
  get(id: string): Promise<JobState | undefined>;
}
