import { z } from "zod";
import { FindingSchema, PlanSchema } from "../../core/domain";

export const MAX_PGN_CHARS = 2_000_000;
export const MAX_PGN_GAMES = 200;
/** Request body cap in bytes: PGN text can be multi-byte, plus JSON overhead. */
export const MAX_BODY_BYTES = 4_200_000;

/** Thrown by start() when another analysis is already running. */
export class ServiceBusyError extends Error {
  constructor() {
    super("Another analysis is already running. Try again in a moment.");
    this.name = "ServiceBusyError";
  }
}

export const ImportRequestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("lichess"), username: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/) }),
  z.object({ source: z.literal("chesscom"), username: z.string().trim().min(3).max(25).regex(/^[A-Za-z0-9_-]+$/) }),
  z.object({
    source: z.literal("pgn"),
    pgn: z
      .string()
      .trim()
      .min(10)
      .max(MAX_PGN_CHARS)
      .refine((p) => (p.match(/^\[Event /gm) ?? []).length <= MAX_PGN_GAMES, {
        message: `At most ${MAX_PGN_GAMES} games per paste`,
      }),
  }),
]);
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const ProgressSchema = z.object({
  stage: z.enum(["import", "engine", "habits", "plan"]),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Progress = z.infer<typeof ProgressSchema>;

/** A real Lichess puzzle (CC0) attached to a chess drill. moves[0] is the opponent's move, the rest is the solution. */
export const PuzzleRefSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9]{1,16}$/),
  fen: z.string().min(1),
  moves: z.array(z.string().min(4).max(5)).min(2),
  rating: z.number().int().positive(),
  themes: z.array(z.string().min(1)),
});
export type PuzzleRef = z.infer<typeof PuzzleRefSchema>;

export const ResultSchema = z.object({
  gamesAnalyzed: z.number().int().nonnegative(),
  findings: z.array(FindingSchema),
  plan: PlanSchema,
  /** Puzzles per chess drill id (additive; the domain Drill type is unchanged). */
  drillPuzzles: z.record(z.string(), z.array(PuzzleRefSchema)).optional(),
  /** False when the puzzle database is missing (the plan view then suggests `npm run setup:puzzles`). */
  puzzlesAvailable: z.boolean().optional(),
  /** Pasted PGN only: the player the analysis assumed to be the user (guessed from the games). */
  assumedPlayer: z.string().min(1).max(40).optional(),
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
