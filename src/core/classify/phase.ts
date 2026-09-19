import type { Chess } from "chess.js";
import type { GamePhase } from "../domain";

/**
 * Board features ported from Lichess's game divider (scalachess Divider.scala, fetched 2026-09):
 *   middlegame starts at the first position with <= 10 majors+minors (non-pawn, non-king pieces, both sides),
 *   OR a sparse back rank (fewer than 4 White pieces on rank 1 or fewer than 4 Black pieces on rank 8);
 *   endgame starts at the first position (after the middlegame began) with <= 6 majors+minors.
 * The third Lichess middlegame trigger, "mixedness" > 150, is NOT ported (simplification), so the
 * middlegame can start a little later than on Lichess in rare structures.
 */
export interface BoardFeatures {
  majorsAndMinors: number;
  backrankSparse: boolean;
}

export function boardFeatures(chess: Chess): BoardFeatures {
  const board = chess.board(); // board[0] is rank 8, board[7] is rank 1
  let majorsAndMinors = 0;
  for (const row of board)
    for (const sq of row) if (sq && sq.type !== "p" && sq.type !== "k") majorsAndMinors++;
  const whiteBack = board[7]?.filter((s) => s?.color === "w").length ?? 0;
  const blackBack = board[0]?.filter((s) => s?.color === "b").length ?? 0;
  return { majorsAndMinors, backrankSparse: whiteBack < 4 || blackBack < 4 };
}

/** Stateful, monotonic phase tracker: feed positions in game order, starting with the initial position. */
export class PhaseTracker {
  private phase: GamePhase = "opening";

  next(chess: Chess): GamePhase {
    const f = boardFeatures(chess);
    if (this.phase === "opening" && (f.majorsAndMinors <= 10 || f.backrankSparse)) this.phase = "middlegame";
    // Like Lichess, the endgame can only start once the middlegame has been detected (checked on the same board).
    if (this.phase === "middlegame" && f.majorsAndMinors <= 6) this.phase = "endgame";
    return this.phase;
  }
}
