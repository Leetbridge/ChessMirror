import { Chess } from "chess.js";
import {
  AnalyzedGameSchema,
  type AnalyzedGame,
  type AnalyzedMove,
  type Game,
  type PositionEval,
} from "../domain";
import { PhaseTracker } from "./phase";
import { classifyLoss, evalToWhiteWinPct } from "./winmodel";

export class ClassifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifyError";
  }
}

export interface GamePosition {
  fen: string;
  /** Game-over positions need no engine call; pass null for them in classifyGame's evals. */
  terminal?: "checkmate" | "draw";
}

/**
 * The positions to evaluate: index 0 is the start, index i is the position after ply i.
 * The caller (src/app) sends the non-terminal ones to the engine, in this order.
 */
export function getPositions(game: Pick<Game, "moves">): GamePosition[] {
  const chess = new Chess();
  const out: GamePosition[] = [{ fen: chess.fen() }];
  for (const mv of game.moves) {
    applyMove(chess, mv.uci, mv.ply);
    const terminal = chess.isCheckmate()
      ? "checkmate"
      : chess.isStalemate() || chess.isInsufficientMaterial()
        ? "draw"
        : undefined;
    out.push({ fen: chess.fen(), ...(terminal ? { terminal } : {}) });
  }
  return out;
}

function applyMove(chess: Chess, uci: string, ply: number): void {
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) });
  } catch {
    throw new ClassifyError(`Illegal move ${uci} at ply ${ply}.`);
  }
}

export interface ClassifyMeta {
  engineName?: string;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

/**
 * Turn a Game plus one evaluation per position (see getPositions) into an AnalyzedGame. Pure.
 * evals[i] is the White-POV evaluation of position i, or null for a terminal position.
 * Terminal positions: checkmate is scored as a win for the mover (mate: 0, winPct 100; the sign of a
 * mate of 0 is not representable, so consumers must rely on winPct), stalemate/insufficient material as evalCp 0.
 * Games with zero moves yield zero analyzed moves.
 */
export function classifyGame(game: Game, evals: readonly (PositionEval | null)[], meta: ClassifyMeta = {}): AnalyzedGame {
  const positions = getPositions(game);
  if (evals.length !== positions.length) {
    throw new ClassifyError(`Expected ${positions.length} evaluations for ${game.moves.length} moves, got ${evals.length}.`);
  }

  const chess = new Chess();
  const tracker = new PhaseTracker();
  const moves: AnalyzedMove[] = [];
  let minDepth = Number.POSITIVE_INFINITY;

  for (const mv of game.moves) {
    const i = mv.ply;
    const moverIsWhite = i % 2 === 1;
    const phase = tracker.next(chess); // phase of the position the mover faced
    const before = evals[i - 1];
    const after = evals[i];
    const posAfter = positions[i];
    if (!before || !after) {
      // Only a terminal position may lack an evaluation, and "before" can never be terminal.
      if (!before) throw new ClassifyError(`Missing evaluation for position before ply ${i}.`);
      if (!posAfter?.terminal) throw new ClassifyError(`Missing evaluation for position after ply ${i}.`);
    }
    if (before) minDepth = Math.min(minDepth, before.depth);
    if (after) minDepth = Math.min(minDepth, after.depth);

    let afterEval: { evalCp?: number; mate?: number };
    let afterWhiteWin: number;
    if (after) {
      afterEval = after.mate !== undefined ? { mate: after.mate } : { evalCp: after.evalCp ?? 0 };
      afterWhiteWin = after.mate === 0 ? (moverIsWhite ? 100 : 0) : evalToWhiteWinPct(after);
    } else if (posAfter?.terminal === "checkmate") {
      afterEval = { mate: 0 };
      afterWhiteWin = moverIsWhite ? 100 : 0;
    } else {
      afterEval = { evalCp: 0 };
      afterWhiteWin = 50;
    }

    const beforeWhiteWin = evalToWhiteWinPct(before as PositionEval);
    const moverBefore = moverIsWhite ? beforeWhiteWin : 100 - beforeWhiteWin;
    const moverAfter = moverIsWhite ? afterWhiteWin : 100 - afterWhiteWin;
    const loss = Math.max(0, moverBefore - moverAfter);
    const bestMoveUci = before?.bestMoveUci;

    moves.push({
      ply: mv.ply,
      san: mv.san,
      uci: mv.uci,
      ...(mv.clockMs !== undefined ? { clockMs: mv.clockMs } : {}),
      ...afterEval,
      winPct: moverAfter,
      winPctBefore: moverBefore,
      class: classifyLoss(loss, bestMoveUci !== undefined && bestMoveUci === mv.uci),
      phase,
      ...(bestMoveUci ? { bestMoveUci } : {}),
    });
    applyMove(chess, mv.uci, mv.ply);
  }

  const { moves: _moves, ...header } = game;
  void _moves;
  return AnalyzedGameSchema.parse({
    game: header,
    moves,
    engine: {
      ...(meta.engineName ? { name: meta.engineName } : {}),
      depth: Number.isFinite(minDepth) ? minDepth : 1,
    },
    analyzedAt: (meta.now ?? new Date()).toISOString(),
  });
}
