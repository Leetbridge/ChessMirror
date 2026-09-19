import type { AnalyzedGame, Finding } from "../domain";
import {
  fastCriticalMoves,
  noResignation,
  thrownWins,
  tiltAfterLoss,
  timeTroubleBlunders,
} from "./detectors";
import type { HabitDetector } from "./types";

export type { HabitDetector } from "./types";
export { SOFT_SKILLS, TEXT } from "./text";
export * as thresholds from "./constants";
export { fastCriticalMoves, noResignation, thrownWins, tiltAfterLoss, timeTroubleBlunders };

export const detectors: readonly HabitDetector[] = [
  timeTroubleBlunders,
  tiltAfterLoss,
  thrownWins,
  fastCriticalMoves,
  noResignation,
];

/** Runs all five detectors; omits detectors that found no pattern. */
export function detectHabits(games: AnalyzedGame[]): Finding[] {
  return detectors.map((d) => d(games)).filter((f): f is Finding => f !== null);
}
