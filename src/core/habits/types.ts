import type { AnalyzedGame, Finding } from "../domain";

/**
 * The single definition of a habit detector (re-exported from `./index`).
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * Return values:
 * - `insufficient_data` finding: too few games or no clock data; we do not guess.
 * - `null`: enough data was available and the pattern was not found.
 * - `detected` finding: the pattern was found, with evidence.
 *
 * `null` exists because the domain `Finding` union has no "not detected"
 * variant; for v0 the reviewer decided to keep `Finding | null` rather than
 * change the domain schema.
 */
export type HabitDetector = (games: AnalyzedGame[]) => Finding | null;
