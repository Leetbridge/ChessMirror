import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { Game, PositionEval } from "../domain";
import {
  ClassifyError,
  PhaseTracker,
  classifyGame,
  classifyLoss,
  cpToWinPct,
  evalToWhiteWinPct,
  getPositions,
} from "./index";

const NOW = new Date("2026-01-01T00:00:00Z");

function gameFrom(ucis: string[], userColor: "white" | "black" = "white"): Game {
  const chess = new Chess();
  const moves = ucis.map((u, i) => {
    const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), ...(u[4] ? { promotion: u[4] } : {}) });
    return { ply: i + 1, san: m.san, uci: u };
  });
  return {
    id: "pgn:test",
    source: "pgn",
    playedAt: "2026-01-01T00:00:00Z",
    white: { name: "w" },
    black: { name: "b" },
    userColor,
    result: "unknown",
    moves,
  };
}

const ev = (evalCp: number, bestMoveUci?: string, depth = 12): PositionEval => ({
  evalCp,
  depth,
  ...(bestMoveUci ? { bestMoveUci } : {}),
});

describe("win% model (Lichess constants)", () => {
  it("matches the Lichess formula", () => {
    expect(cpToWinPct(0)).toBe(50);
    expect(cpToWinPct(100)).toBeCloseTo(59.1, 1);
    expect(cpToWinPct(300)).toBeCloseTo(75.1, 1);
    expect(cpToWinPct(-100)).toBeCloseTo(100 - cpToWinPct(100), 10);
  });
  it("clamps at +-1000 cp and treats mate as the ceiling", () => {
    expect(cpToWinPct(5000)).toBe(cpToWinPct(1000));
    expect(cpToWinPct(1000)).toBeCloseTo(97.55, 1);
    expect(evalToWhiteWinPct({ mate: 3 })).toBe(cpToWinPct(1000));
    expect(evalToWhiteWinPct({ mate: -1 })).toBe(cpToWinPct(-1000));
  });
});

describe("classifyLoss thresholds (win% points 5 / 10 / 15)", () => {
  it("classifies at the boundaries", () => {
    expect(classifyLoss(0, true)).toBe("best");
    expect(classifyLoss(0, false)).toBe("good");
    expect(classifyLoss(4.99, false)).toBe("good");
    expect(classifyLoss(5, false)).toBe("inaccuracy");
    expect(classifyLoss(9.99, false)).toBe("inaccuracy");
    expect(classifyLoss(10, false)).toBe("mistake");
    expect(classifyLoss(15, false)).toBe("blunder");
    expect(classifyLoss(15, true)).toBe("blunder");
  });
});

describe("phase", () => {
  it("is opening at the start and never goes backwards", () => {
    const t = new PhaseTracker();
    expect(t.next(new Chess())).toBe("opening");
    expect(t.next(new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"))).toBe("endgame");
    expect(t.next(new Chess())).toBe("endgame");
  });
  it("detects a sparse back rank as middlegame", () => {
    const t = new PhaseTracker();
    // White has only 3 pieces on rank 1 (a1, e1, h1), but many minor/major pieces remain elsewhere.
    expect(t.next(new Chess("rnbqkbnr/pppppppp/8/8/8/1NBQ1BN1/PPPPPPPP/R3K2R w KQkq - 0 1"))).toBe("middlegame");
  });
  it("middlegame at <= 10 majors and minors, endgame at <= 6", () => {
    const t = new PhaseTracker();
    // 5 pieces per side (10 in total), back ranks still full enough: middlegame but not endgame.
    expect(t.next(new Chess("r1bqkb1r/pppppppp/8/8/8/8/PPPPPPPP/R1BQKB1R w - - 0 1"))).toBe("middlegame");
    // 3 per side (6 in total): endgame.
    expect(t.next(new Chess("r2qk3/pppppppp/8/8/8/8/PPPPPPPP/R2QK3 w - - 0 1"))).toBe("endgame");
  });
});

describe("classifyGame golden: fool's mate", () => {
  // 1. f3 e5 2. g4 Qh4#
  const game = gameFrom(["f2f3", "e7e5", "g2g4", "d8h4"]);
  // White-POV evals of positions 0..3; position 4 is checkmate (null).
  const evals = [
    ev(20, "e2e4"), // start: e4 is best
    ev(-50, "e7e5"), // after 1.f3
    ev(-30, "b1c3"), // after 1...e5, best would be something else for white
    ev(-900, "d8h4"), // after 2.g4?? black has mate
    null,
  ];
  const a = classifyGame(game, evals, { engineName: "Fake", now: NOW });

  it("positions flag the mate as terminal", () => {
    const p = getPositions(game);
    expect(p).toHaveLength(5);
    expect(p[4]?.terminal).toBe("checkmate");
    expect(p[3]?.terminal).toBeUndefined();
  });
  it("classifies each move", () => {
    expect(a.moves.map((m) => m.class)).toEqual(["inaccuracy", "best", "blunder", "best"]);
  });
  it("uses the mover's point of view for winPct", () => {
    const [m1, m2, m3, m4] = a.moves;
    expect(m1?.winPctBefore).toBeCloseTo(cpToWinPct(20), 10);
    expect(m1?.winPct).toBeCloseTo(cpToWinPct(-50), 10);
    expect(m2?.winPctBefore).toBeCloseTo(100 - cpToWinPct(-50), 10);
    expect(m2?.winPct).toBeCloseTo(100 - cpToWinPct(-30), 10);
    expect(m3?.winPct).toBeCloseTo(cpToWinPct(-900), 10);
    expect(m4?.winPct).toBe(100);
    expect(m4?.mate).toBe(0);
    expect(m4?.evalCp).toBeUndefined();
  });
  it("carries best move, eval and metadata", () => {
    expect(a.moves[0]).toMatchObject({ ply: 1, san: "f3", uci: "f2f3", evalCp: -50, bestMoveUci: "e2e4", phase: "opening" });
    expect(a.engine).toEqual({ name: "Fake", depth: 12 });
    expect(a.analyzedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(a.game).not.toHaveProperty("moves");
  });
});

describe("classifyGame edge cases", () => {
  it("handles a one-move game", () => {
    const a = classifyGame(gameFrom(["e2e4"]), [ev(20, "e2e4"), ev(30, "e7e5", 10)]);
    expect(a.moves).toHaveLength(1);
    expect(a.moves[0]?.class).toBe("best");
    expect(a.engine.depth).toBe(10);
  });
  it("handles a game with zero moves (aborted)", () => {
    const a = classifyGame(gameFrom([]), [ev(15)]);
    expect(a.moves).toEqual([]);
  });
  it("maps mate scores to White POV win% and keeps the mate field", () => {
    // Black delays: white was mating (mate 2), black's reply is forced; white then loses the mate (-> +300).
    const game = gameFrom(["e2e4", "e7e5", "d1h5"]);
    const a = classifyGame(game, [ev(20, "e2e4"), ev(20), { mate: 2, depth: 12, bestMoveUci: "d1h5" }, ev(300)]);
    expect(a.moves[1]?.mate).toBe(2);
    expect(a.moves[1]?.winPct).toBeCloseTo(100 - cpToWinPct(1000), 10);
    expect(a.moves[1]?.class).toBe("blunder");
    // White's move from mate-in-2 to +300 loses 97.5 -> 75.1 win%: blunder.
    expect(a.moves[2]?.class).toBe("blunder");
  });
  it("scores stalemate as a draw", () => {
    // Known stalemate in 10: Sam Loyd's fastest stalemate.
    const ucis = ["e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "h2h4", "a6h6", "a5c7", "f7f6", "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6"];
    const game = gameFrom(ucis);
    const pos = getPositions(game);
    expect(pos.at(-1)?.terminal).toBe("draw");
    const evals = pos.map((p) => (p.terminal ? null : ev(0)));
    const a = classifyGame(game, evals);
    expect(a.moves.at(-1)?.evalCp).toBe(0);
    expect(a.moves.at(-1)?.winPct).toBe(50);
  });
  it("rejects a wrong number of evaluations, a missing non-terminal eval and illegal moves", () => {
    const g = gameFrom(["e2e4", "e7e5"]);
    expect(() => classifyGame(g, [ev(0)])).toThrow(ClassifyError);
    expect(() => classifyGame(g, [ev(0), null, ev(0)])).toThrow(/Missing evaluation/);
    const bad: Game = { ...g, moves: [{ ply: 1, san: "e5", uci: "e7e5" }] };
    expect(() => classifyGame(bad, [ev(0), ev(0)])).toThrow(/Illegal move/);
  });
});
