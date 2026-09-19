import type { AnalyzedGame, Finding } from "../domain";

/**
 * Pure: no I/O, no clock, no randomness. Returns an `insufficient_data`
 * finding instead of guessing when there are too few games or no clock data.
 */
export type HabitDetector = (games: AnalyzedGame[]) => Finding;
