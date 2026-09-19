import { FindingSchema, PlanSchema } from "../../core/domain";
import { JobStateSchema, type AnalysisResult, type AnalysisService, type ImportRequest, type JobState } from "./types";

const GAMES = 24;
const DURATION_MS = 3000;
const STAGES = ["import", "engine", "habits", "plan"] as const;

export function buildMockResult(gamesAnalyzed = GAMES): AnalysisResult {
  const findings = FindingSchema.array().parse([
    {
      id: "f-time-trouble",
      detector: "time-trouble-blunders",
      status: "detected",
      evidence: [
        { gameId: "mock:g07", ply: 31, note: "Blunder with 0:12 left on the clock" },
        { gameId: "mock:g11", ply: 44, note: "Blunder with 0:09 left" },
        { gameId: "mock:g19", ply: 37, note: "Mistake with 0:15 left" },
      ],
      severity: "high",
      confidence: 0.78,
      explanation:
        "In 3 of your 5 games that reached under 30 seconds, the largest evaluation drop happened in that window. This pattern is consistent with time pressure affecting move quality.",
      chessDrill: {
        id: "d-time-chess",
        kind: "chess",
        title: "Play 10 minute games with a 15 second budget rule",
        description: "Decide on a move within 15 seconds in quiet positions to bank time for critical ones.",
        puzzleThemes: ["advantage", "short"],
      },
      softSkillDrill: {
        id: "d-time-soft",
        kind: "soft_skill",
        title: "Pause and check the clock every 10 moves",
        description: "Set a reminder to glance at the clock and re-plan your remaining time.",
      },
    },
    {
      id: "f-winning-positions",
      detector: "throwing-away-winning-positions",
      status: "detected",
      evidence: [
        { gameId: "mock:g03", ply: 52, note: "Evaluation fell from +4.1 to 0.0" },
        { gameId: "mock:g15", ply: 61, note: "Winning endgame turned into a draw" },
      ],
      severity: "medium",
      confidence: 0.55,
      explanation:
        "Two games show a large advantage that was not converted. This may suggest difficulty simplifying when ahead; two games is a small sample.",
      chessDrill: {
        id: "d-convert-chess",
        kind: "chess",
        title: "Convert won endgames against the engine",
        description: "Start from winning positions and practise trading pieces safely.",
        puzzleThemes: ["endgame", "crushing", "advancedPawn"],
      },
      softSkillDrill: {
        id: "d-convert-soft",
        kind: "soft_skill",
        title: "Write a one-line plan when you are ahead",
        description: "Before each move while ahead, name what you will trade or simplify.",
      },
    },
    {
      id: "f-fast-moves",
      detector: "too-fast-critical-moves",
      status: "detected",
      evidence: [{ gameId: "mock:g09", ply: 22, note: "Move played in 1s in a tactical position" }],
      severity: "low",
      confidence: 0.32,
      explanation:
        "One critical position was answered very quickly. This is weak evidence and may not indicate a recurring habit.",
      chessDrill: {
        id: "d-fast-chess",
        kind: "chess",
        title: "Blunder-check routine",
        description: "Before moving, list opponent checks, captures and threats.",
        puzzleThemes: ["hangingPiece", "fork"],
      },
      softSkillDrill: {
        id: "d-fast-soft",
        kind: "soft_skill",
        title: "Slow down on captures",
        description: "Take a breath before any capture or check.",
      },
    },
    {
      id: "f-tilt",
      detector: "tilt-after-loss",
      status: "insufficient_data",
      reason: "Needs at least 10 games with consecutive losses; found 2.",
    },
    {
      id: "f-resign",
      detector: "never-resigning",
      status: "insufficient_data",
      reason: "Fewer than 3 lost games in the sample.",
    },
  ]);
  const plan = PlanSchema.parse({
    id: "plan-mock",
    createdAt: new Date().toISOString(),
    findingIds: findings.filter((f) => f.status === "detected").map((f) => f.id),
    chessDrills: findings.flatMap((f) => (f.status === "detected" ? [f.chessDrill] : [])),
    softSkillDrills: findings.flatMap((f) => (f.status === "detected" ? [f.softSkillDrill] : [])),
    puzzleThemes: ["advantage", "endgame", "crushing", "hangingPiece", "fork"],
  });
  return { gamesAnalyzed, findings, plan };
}

interface Job {
  startedAt: number;
  request: ImportRequest;
}

/** Demo behaviour: username "error-demo" fails, "empty-demo" yields no games. */
export function createMockService(now: () => number = Date.now): AnalysisService {
  const jobs = new Map<string, Job>();
  return {
    async start(request) {
      const id = crypto.randomUUID();
      jobs.set(id, { startedAt: now(), request });
      return { id };
    },
    async get(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      const name = job.request.source === "pgn" ? "" : job.request.username.toLowerCase();
      const ratio = Math.min(1, (now() - job.startedAt) / DURATION_MS);
      let state: JobState;
      if (name === "error-demo" && ratio > 0.4) {
        state = { state: "error", message: "Could not reach the game source (mock error)." };
      } else if (ratio < 1) {
        const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(ratio * STAGES.length))] ?? "import";
        state = { state: "running", progress: { stage, done: Math.floor(ratio * GAMES), total: GAMES } };
      } else if (name === "empty-demo") {
        state = { state: "done", result: { ...buildMockResult(0), gamesAnalyzed: 0, findings: [] } };
      } else {
        state = { state: "done", result: buildMockResult() };
      }
      return JobStateSchema.parse(state);
    },
  };
}
