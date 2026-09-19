import { describe, expect, it } from "vitest";
import {
  AnalyzedGameSchema,
  AnalyzedMoveSchema,
  FindingSchema,
  GameSchema,
  MoveSchema,
  PlanSchema,
} from "./index";

const move = { ply: 1, san: "e4", uci: "e2e4" };
const game = {
  id: "lichess:abc123",
  source: "lichess",
  playedAt: "2026-01-02T03:04:05Z",
  white: { name: "me", rating: 1500 },
  black: { name: "them" },
  userColor: "white",
  result: "white",
  moves: [move, { ply: 2, san: "e5", uci: "e7e5", clockMs: 59000 }],
};
const drill = (kind: "chess" | "soft_skill") => ({
  id: `d-${kind}`,
  kind,
  title: "t",
  description: "d",
});

describe("Move / Game", () => {
  it("accepts a valid game with optional clockMs", () => {
    const parsed = GameSchema.parse(game);
    expect(parsed.moves[0]?.clockMs).toBeUndefined();
    expect(parsed.moves[1]?.clockMs).toBe(59000);
  });
  it("rejects ply 0, negative clock and unknown source", () => {
    expect(MoveSchema.safeParse({ ...move, ply: 0 }).success).toBe(false);
    expect(MoveSchema.safeParse({ ...move, clockMs: -1 }).success).toBe(false);
    expect(GameSchema.safeParse({ ...game, source: "other" }).success).toBe(false);
  });
});

describe("AnalyzedMove", () => {
  const base = { ...move, winPct: 55, class: "best" };
  it("accepts evalCp or mate", () => {
    expect(AnalyzedMoveSchema.safeParse({ ...base, evalCp: 20 }).success).toBe(true);
    expect(AnalyzedMoveSchema.safeParse({ ...base, mate: -3 }).success).toBe(true);
  });
  it("rejects both or neither eval", () => {
    expect(AnalyzedMoveSchema.safeParse({ ...base, evalCp: 20, mate: 2 }).success).toBe(false);
    expect(AnalyzedMoveSchema.safeParse(base).success).toBe(false);
  });
  it("rejects bad class and out-of-range winPct", () => {
    expect(AnalyzedMoveSchema.safeParse({ ...base, evalCp: 0, class: "brilliant" }).success).toBe(false);
    expect(AnalyzedMoveSchema.safeParse({ ...base, evalCp: 0, winPct: 101 }).success).toBe(false);
  });
});

describe("AnalyzedGame", () => {
  it("accepts a valid analyzed game", () => {
    const { moves: _moves, ...header } = game;
    void _moves;
    const r = AnalyzedGameSchema.safeParse({
      game: header,
      moves: [{ ...move, evalCp: 10, winPct: 51, class: "good" }],
      engine: { depth: 12 },
      analyzedAt: "2026-01-02T03:04:05Z",
    });
    expect(r.success).toBe(true);
  });
});

describe("Finding", () => {
  const detected = {
    id: "f1",
    detector: "time-trouble-blunders",
    status: "detected",
    evidence: [{ gameId: "lichess:abc123", ply: 31 }],
    severity: "high",
    confidence: 0.7,
    explanation: "This pattern is consistent with time pressure.",
    chessDrill: drill("chess"),
    softSkillDrill: drill("soft_skill"),
  };
  it("accepts a detected finding", () => {
    expect(FindingSchema.safeParse(detected).success).toBe(true);
  });
  it("accepts insufficient_data without evidence", () => {
    const r = FindingSchema.safeParse({
      id: "f2",
      detector: "tilt",
      status: "insufficient_data",
      reason: "Only 2 games",
    });
    expect(r.success).toBe(true);
  });
  it("rejects a detected finding without evidence or with confidence > 1", () => {
    expect(FindingSchema.safeParse({ ...detected, evidence: [] }).success).toBe(false);
    expect(FindingSchema.safeParse({ ...detected, confidence: 1.5 }).success).toBe(false);
  });
});

describe("Plan", () => {
  it("accepts a plan", () => {
    const r = PlanSchema.safeParse({
      id: "p1",
      createdAt: "2026-01-02T03:04:05Z",
      findingIds: ["f1"],
      chessDrills: [drill("chess")],
      softSkillDrills: [drill("soft_skill")],
      puzzleThemes: ["hangingPiece"],
    });
    expect(r.success).toBe(true);
  });
});
