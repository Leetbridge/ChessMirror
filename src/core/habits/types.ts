import type { AnalyzedGame, Finding } from "../domain";

/**
 * Pure: no I/O, no clock, no randomness. Returns an `insufficient_data`
 * finding instead of guessing when there are too few games or no clock data.
 *
 * Returns `null` when there was enough data but the pattern was not found
 * (the domain `Finding` union has no "not detected" variant; see report).
 */
export type HabitDetector = (games: AnalyzedGame[]) => Finding | null;
