import { describe, expect, it } from "vitest";
import { FindingSchema, type AnalyzedGame, type DetectedFinding, type Finding } from "../domain";
import { estimatedTotalSec, fastMoveMs } from "./helpers";
import {
  detectHabits,
  fastCriticalMoves,
  noResignation,
  SOFT_SKILLS,
  thrownWins,
  tiltAfterLoss,
  timeTroubleBlunders,
} from "./index";
import {
  BULLET,
  RAPID,
  fastScenario,
  lostScenario,
  noClockGames,
  thrownScenario,
  tiltScenario,
  timeTroubleNegative,
  timeTroublePositive,
} from "./testing/scenarios";

function expectDetected(f: Finding | null): DetectedFinding {
  expect(f).not.toBeNull();
  expect(f?.status).toBe("detected");
  if (!f || f.status !== "detected") throw new Error("expected a detected finding");
  expect(FindingSchema.safeParse(f).success).toBe(true);
  expect(f.chessDrill.kind).toBe("chess");
  expect(f.softSkillDrill.kind).toBe("soft_skill");
  expect(f.evidence.length).toBeGreaterThan(0);
  expect(f.evidence.length).toBeLessThanOrEqual(10);
  expect(f.confidence).toBeGreaterThan(0);
  expect(f.confidence).toBeLessThanOrEqual(1);
  return f;
}

function expectInsufficient(f: Finding | null, reasonPart: RegExp) {
  expect(f?.status).toBe("insufficient_data");
  if (f?.status === "insufficient_data") expect(f.reason).toMatch(reasonPart);
}

describe("timeTroubleBlunders", () => {
  it("detects blunders concentrated in time trouble", () => {
    const f = expectDetected(timeTroubleBlunders(timeTroublePositive()));
    expect(f.detector).toBe("time-trouble-blunders");
    expect(f.severity).toBe("high"); // 100% of blunders in time trouble
    expect(f.confidence).toBe(0.65); // 5 blunders: 0.3 + 0.7 * 5/10
    expect(f.evidence).toHaveLength(5);
    expect(f.evidence[0]).toMatchObject({ gameId: "tt:0", ply: 55 });
    expect(f.explanation).toMatch(/5 of 5 blunders \(100%\)/);
    expect(SOFT_SKILLS[f.detector as keyof typeof SOFT_SKILLS]).toBe("Time management under pressure");
  });
  it("returns null when blunders happen with ample time", () => {
    expect(timeTroubleBlunders(timeTroubleNegative())).toBeNull();
  });
  it("is insufficient without clock data", () => {
    expectInsufficient(timeTroubleBlunders(noClockGames()), /clock data; found 0/);
  });
  it("is insufficient with too few games", () => {
    expectInsufficient(timeTroubleBlunders(timeTroublePositive().slice(0, 3)), /clock data; found 3/);
  });
});

describe("tiltAfterLoss", () => {
  it("detects a higher blunder rate right after losses", () => {
    const f = expectDetected(tiltAfterLoss(tiltScenario({ postBlunders: 2, baselineBlunders: 0 })));
    expect(f.detector).toBe("tilt-after-loss");
    expect(f.severity).toBe("high");
    expect(f.evidence).toHaveLength(6);
    expect(f.evidence.every((e) => e.gameId.startsWith("post:"))).toBe(true);
    expect(f.explanation).toMatch(/3 games started soon after a loss/);
    expect(f.explanation).toMatch(/7% of moves versus 0%/);
  });
  it("returns null when post-loss games are as clean as the baseline", () => {
    expect(tiltAfterLoss(tiltScenario({ postBlunders: 0, baselineBlunders: 3 }))).toBeNull();
  });
  it("is insufficient with fewer than 10 games", () => {
    expectInsufficient(tiltAfterLoss(tiltScenario({ postBlunders: 2, baselineBlunders: 0 }).slice(0, 6)), /at least 10 games; found 6/);
  });
  it("is insufficient when no games follow a loss soon enough", () => {
    // Base-only games: 6 standalone wins repeated via thrownScenario conversions are all wins.
    const games = thrownScenario(0, 12, 0);
    expectInsufficient(tiltAfterLoss(games), /within 45 minutes after a loss; found 0/);
  });
});

describe("thrownWins", () => {
  it("detects winning positions that were not converted", () => {
    const f = expectDetected(thrownWins(thrownScenario(4, 1)));
    expect(f.detector).toBe("thrown-wins");
    expect(f.severity).toBe("high"); // 4 of 5 = 80%
    expect(f.evidence).toHaveLength(4);
    expect(f.evidence[0]).toMatchObject({ gameId: "thrown:0", ply: 5 });
    expect(f.explanation).toMatch(/4 of 5 games/);
    expect(SOFT_SKILLS["thrown-wins"]).toBe("Patience and converting");
  });
  it("returns null when winning positions are converted", () => {
    expect(thrownWins(thrownScenario(1, 5))).toBeNull();
  });
  it("is insufficient with too few games", () => {
    expectInsufficient(thrownWins(thrownScenario(3, 0, 0).slice(0, 2)), /known result; found 2/);
  });
  it("is insufficient when the player rarely reached winning positions", () => {
    expectInsufficient(thrownWins(thrownScenario(1, 1, 5)), /winning position; found 2/);
  });
});

describe("fastCriticalMoves", () => {
  it("detects quick errors with ample clock in balanced positions", () => {
    const f = expectDetected(fastCriticalMoves(fastScenario(1_000)));
    expect(f.detector).toBe("fast-critical-moves");
    expect(f.severity).toBe("high"); // all 12 errors were fast
    expect(f.evidence).toHaveLength(10); // capped from 12
    expect(f.evidence[0]).toMatchObject({ gameId: "fast:0", ply: 41 });
    expect(f.explanation).toMatch(/12 of 12 mistakes/);
  });
  it("returns null when errors were made after longer thought", () => {
    expect(fastCriticalMoves(fastScenario(20_000))).toBeNull();
  });
  it("ignores fast errors in already-winning positions", () => {
    expect(fastCriticalMoves(fastScenario(1_000, 95))).toBeNull();
  });
  it("is insufficient without clock data", () => {
    expectInsufficient(fastCriticalMoves(noClockGames()), /at least 5 games with clock data; found 0/);
  });
  it("does NOT flag a bullet-only player with many fast mistakes", () => {
    const f = fastCriticalMoves(fastScenario(1_000, 50, BULLET));
    expectInsufficient(f, /time control.*bullet games are excluded.*found 0 of 6/);
  });
  it("flags a rapid player with the same fast-mistake pattern", () => {
    const f = expectDetected(fastCriticalMoves(fastScenario(1_000, 50, RAPID)));
    expect(f.severity).toBe("high");
    expect(f.explanation).toMatch(/12 of 12 mistakes/);
  });
  it("scales the fast threshold with the time control (3+0 is 0.9s)", () => {
    const blitz = { initialSec: 180, incrementSec: 0 };
    expect(fastCriticalMoves(fastScenario(800, 50, blitz))?.status).toBe("detected");
    expect(fastCriticalMoves(fastScenario(1_000, 50, blitz))).toBeNull();
  });
  it("does not flag 20s mistakes at a slow time control (15+10)", () => {
    expect(fastCriticalMoves(fastScenario(20_000, 50, RAPID))).toBeNull();
  });
  it("is insufficient when games have clocks but no time control", () => {
    expectInsufficient(fastCriticalMoves(fastScenario(1_000, 50, null)), /known time control.*found 0 of 6/);
  });
  it("includes exactly 180s estimated length (60+3) and excludes 179s (59+3)", () => {
    const at180 = { initialSec: 60, incrementSec: 3 };
    const at179 = { initialSec: 59, incrementSec: 3 };
    expect(estimatedTotalSec(fastScenario(800, 50, at180)[0] as AnalyzedGame)).toBe(180);
    expect(fastCriticalMoves(fastScenario(800, 50, at180))?.status).toBe("detected");
    expectInsufficient(fastCriticalMoves(fastScenario(800, 50, at179)), /found 0 of 6/);
  });
  it("caps the fast threshold at 5000 ms (15+10: 5000 fast, 5001 not)", () => {
    expect(fastMoveMs(fastScenario(1, 50, RAPID)[0] as AnalyzedGame)).toBe(5_000);
    expect(fastCriticalMoves(fastScenario(5_000, 50, RAPID))?.status).toBe("detected");
    expect(fastCriticalMoves(fastScenario(5_001, 50, RAPID))).toBeNull();
  });
  it("uses exactly 900 ms at the 180s minimum (3+0): 900 fast, 901 not", () => {
    const blitz = { initialSec: 180, incrementSec: 0 };
    expect(fastMoveMs(fastScenario(1, 50, blitz)[0] as AnalyzedGame)).toBe(900);
    expect(fastCriticalMoves(fastScenario(900, 50, blitz))?.status).toBe("detected");
    expect(fastCriticalMoves(fastScenario(901, 50, blitz))).toBeNull();
  });
  it("500 ms floor is unreachable for eligible games (lowest eligible threshold is 900 ms)", () => {
    // 20% of the per-move budget only drops below 500 ms when estimated length < 100s,
    // which is already excluded by the 180s minimum. The floor is purely defensive.
    const lowest = { initialSec: 180, incrementSec: 0 };
    expect(fastMoveMs(fastScenario(1, 50, lowest)[0] as AnalyzedGame)).toBeGreaterThan(500);
    expect(fastMoveMs(fastScenario(1, 50, { initialSec: 179, incrementSec: 0 })[0] as AnalyzedGame)).toBeUndefined();
  });
  it("returns null when lost games were short after becoming hopeless", () => {
    expect(noResignation(lostScenario(3))).toBeNull();
  });
  it("is insufficient with too few games", () => {
    expectInsufficient(noResignation(lostScenario(10, 3)), /at least 5 games; found 3/);
  });
  it("excludes bullet games: playing on may be rational there", () => {
    expectInsufficient(noResignation(lostScenario(10, 6, BULLET)), /bullet games are excluded.*found 0 of 6/);
  });
  it("still detects play-on at slower time controls", () => {
    expect(noResignation(lostScenario(10, 6, RAPID))?.status).toBe("detected");
  });
  it("is insufficient when there are not enough hopeless lost games", () => {
    expectInsufficient(noResignation(thrownScenario(0, 6, 0)), /hopeless position; found 0/);
  });
});

describe("detectHabits", () => {
  it("returns findings for detected and insufficient detectors, omitting negatives", () => {
    const out = detectHabits(lostScenario(10));
    const byId = Object.fromEntries(out.map((f) => [f.detector, f.status]));
    expect(byId["no-resignation"]).toBe("detected");
    expect(byId["time-trouble-blunders"]).toBe("insufficient_data");
  });
  it("is deterministic and does not mutate its input", () => {
    const games = tiltScenario({ postBlunders: 2, baselineBlunders: 0 });
    const snapshot = JSON.stringify(games);
    expect(detectHabits(games)).toEqual(detectHabits(games));
    expect(JSON.stringify(games)).toBe(snapshot);
  });
});
