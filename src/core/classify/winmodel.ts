import type { MoveClass, PositionEval } from "../domain";

/**
 * Centipawn -> winning chances model.
 *
 * Source (verified against the Lichess accuracy page https://lichess.org/page/accuracy and lila source
 * modules/tree/src/main/Advice.scala + scalachess core/src/main/scala/eval.scala, fetched 2026-09):
 *   winPct = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 * Centipawns are clamped to +-1000 first (scalachess Eval.Cp.CEILING), and a mate score counts as +-1000 cp.
 */
export const WIN_MODEL_K = 0.00368208;
export const CP_CEILING = 1000;

/** White's winning chances for a White-POV centipawn score, 0 to 100. */
export function cpToWinPct(cp: number): number {
  const c = Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_MODEL_K * c)) - 1);
}

/** White's winning chances for a White-POV evaluation (mate counts as +-1000 cp; mate 0 is not handled here). */
export function evalToWhiteWinPct(e: Pick<PositionEval, "evalCp" | "mate">): number {
  if (e.mate !== undefined) return cpToWinPct(e.mate > 0 ? CP_CEILING : -CP_CEILING);
  return cpToWinPct(e.evalCp ?? 0);
}

/**
 * Win% lost by a move, in win% points (mover's POV), thresholds on the win% drop.
 * Lichess (lila Advice.scala CpAdvice): drop in winning chances >= 0.1 inaccuracy, >= 0.2 mistake, >= 0.3 blunder.
 * Winning chances live on a -1..+1 scale, so in win% points (0..100) these are 5, 10 and 15.
 */
export const LOSS_THRESHOLDS = { inaccuracy: 5, mistake: 10, blunder: 15 } as const;

/**
 * "best" and "good" are chessmirror's own labels (Lichess has no such classes):
 * best = the engine's first choice, good = anything below the inaccuracy threshold.
 */
export function classifyLoss(lossPct: number, isEngineBest: boolean): MoveClass {
  if (lossPct >= LOSS_THRESHOLDS.blunder) return "blunder";
  if (lossPct >= LOSS_THRESHOLDS.mistake) return "mistake";
  if (lossPct >= LOSS_THRESHOLDS.inaccuracy) return "inaccuracy";
  return isEngineBest ? "best" : "good";
}
