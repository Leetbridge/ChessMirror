import type { AnalyzedGame, Finding } from "../../domain";
import { buildCoachContext, type CoachContext } from "../context";

const header = (id: string, result: "white" | "black" | "draw") => ({
  id,
  source: "lichess" as const,
  playedAt: "2026-03-01T10:00:00Z",
  white: { name: "user1" },
  black: { name: "opp1" },
  userColor: "white" as const,
  result,
  timeControl: { initialSec: 300, incrementSec: 0 },
});

const mv = (
  ply: number,
  san: string,
  uci: string,
  extra: { clockMs?: number; best?: string; cls?: "blunder" | "mistake" | "good" },
) => ({
  ply,
  san,
  uci,
  ...(extra.clockMs !== undefined ? { clockMs: extra.clockMs } : {}),
  evalCp: -250,
  winPct: 20,
  winPctBefore: 60,
  class: extra.cls ?? ("blunder" as const),
  ...(extra.best ? { bestMoveUci: extra.best } : {}),
});

export const analyzedGames: AnalyzedGame[] = [
  {
    game: header("lichess:AAA111", "black"),
    engine: { depth: 14 },
    analyzedAt: "2026-03-02T00:00:00Z",
    moves: [
      mv(31, "Nf3", "g1f3", { clockMs: 9000, best: "d1d2" }),
      mv(35, "Qh5", "d1h5", { clockMs: 6000, best: "f1e1" }),
    ],
  },
  {
    game: header("lichess:BBB222", "black"),
    engine: { depth: 14 },
    analyzedAt: "2026-03-02T00:00:00Z",
    moves: [mv(41, "Rxe5", "e1e5", { clockMs: 4000, best: "e1e2" })],
  },
  {
    game: header("lichess:CCC333", "black"),
    engine: { depth: 14 },
    analyzedAt: "2026-03-02T00:00:00Z",
    moves: [
      mv(12, "Bxh7", "d3h7", { clockMs: 120000, best: "d3e2", cls: "mistake" }),
      mv(14, "Qxb2", "d1b2", { clockMs: 110000, best: "a1b1", cls: "mistake" }),
    ],
  },
];

const drill = (id: string, kind: "chess" | "soft_skill", title: string, description: string) => ({
  id,
  kind,
  title,
  description,
});

export const findings: Finding[] = [
  {
    id: "f-time",
    detector: "time-trouble-blunders",
    status: "detected",
    evidence: [
      { gameId: "lichess:AAA111", ply: 31 },
      { gameId: "lichess:AAA111", ply: 35 },
      { gameId: "lichess:BBB222", ply: 41 },
    ],
    severity: "high",
    confidence: 0.8,
    explanation: "Your blunders cluster below 10 seconds; this is consistent with time pressure.",
    chessDrill: drill("d-time-chess", "chess", "Blunder-check puzzles", "Solve 10 one-move puzzles with a 15 second limit."),
    softSkillDrill: drill("d-time-soft", "soft_skill", "Clock budget", "Set a checkpoint at half your time before move 20."),
  },
  {
    id: "f-tilt",
    detector: "tilt-after-loss",
    status: "detected",
    evidence: [
      { gameId: "lichess:CCC333", ply: 12 },
      { gameId: "lichess:CCC333", ply: 14 },
    ],
    severity: "medium",
    confidence: 0.6,
    explanation: "Right after a loss you made two mistakes in the opening; this may suggest a pattern after defeats.",
    chessDrill: drill("d-tilt-chess", "chess", "Opening safety check", "Before each capture, list the opponent's replies."),
    softSkillDrill: drill("d-tilt-soft", "soft_skill", "Reset routine", "Take a two minute break after a loss before queueing again."),
  },
  {
    id: "f-resign",
    detector: "never-resigns",
    status: "insufficient_data",
    reason: "Only 3 games",
  },
];

export const ctx: CoachContext = buildCoachContext(findings, analyzedGames);
