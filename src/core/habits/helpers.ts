import type { AnalyzedGame, AnalyzedMove, EvidenceRef, InsufficientDataFinding, Severity } from "../domain";
import {
  CLOCK_COVERAGE_MIN,
  MAX_EVIDENCE,
  TIME_TROUBLE_CAP_MS,
  TIME_TROUBLE_FALLBACK_MS,
  TIME_TROUBLE_FRACTION,
} from "./constants";

export type Outcome = "win" | "loss" | "draw" | "unknown";

export function outcome(g: AnalyzedGame): Outcome {
  const r = g.game.result;
  if (r === "unknown") return "unknown";
  if (r === "draw") return "draw";
  return r === g.game.userColor ? "win" : "loss";
}

/** The analyzed user's moves (white plays odd plies). */
export function userMoves(g: AnalyzedGame): AnalyzedMove[] {
  const odd = g.game.userColor === "white";
  return g.moves.filter((m) => (m.ply % 2 === 1) === odd);
}

/** User's win% before the given move: recorded value, else derived from the opponent's previous move, else 50. */
export function winPctBefore(g: AnalyzedGame, m: AnalyzedMove): number {
  if (m.winPctBefore !== undefined) return m.winPctBefore;
  const prev = g.moves.find((x) => x.ply === m.ply - 1);
  return prev ? 100 - prev.winPct : 50;
}

export function hasClockData(g: AnalyzedGame): boolean {
  const mine = userMoves(g);
  if (mine.length === 0) return false;
  return mine.filter((m) => m.clockMs !== undefined).length / mine.length >= CLOCK_COVERAGE_MIN;
}

export function timeTroubleMs(g: AnalyzedGame): number {
  const tc = g.game.timeControl;
  if (!tc) return TIME_TROUBLE_FALLBACK_MS;
  return Math.min(TIME_TROUBLE_CAP_MS, tc.initialSec * 1000 * TIME_TROUBLE_FRACTION);
}

/** Clock ms spent on a user move (including increment refund), or undefined if unknown. */
export function spentMs(g: AnalyzedGame, m: AnalyzedMove): number | undefined {
  if (m.clockMs === undefined) return undefined;
  const prev = g.moves.find((x) => x.ply === m.ply - 2);
  const tc = g.game.timeControl;
  let before: number | undefined;
  if (prev) before = prev.clockMs;
  else if (m.ply <= 2 && tc) before = tc.initialSec * 1000;
  if (before === undefined) return undefined;
  return Math.max(0, before - m.clockMs + (tc?.incrementSec ?? 0) * 1000);
}

export function ref(gameId: string, ply: number, note?: string): EvidenceRef {
  return note === undefined ? { gameId, ply } : { gameId, ply, note };
}

export function capEvidence(e: EvidenceRef[]): EvidenceRef[] {
  return e.slice(0, MAX_EVIDENCE);
}

/** Confidence in [0.3, 1]: grows with sample size, saturating at `full`. Rounded to 2 dp. */
export function confidence(n: number, full: number): number {
  return Math.round((0.3 + 0.7 * Math.min(1, n / full)) * 100) / 100;
}

export function severityBy(value: number, medium: number, high: number): Severity {
  return value >= high ? "high" : value >= medium ? "medium" : "low";
}

export function insufficient(detector: string, reason: string): InsufficientDataFinding {
  return { id: detector, detector, status: "insufficient_data", reason };
}
