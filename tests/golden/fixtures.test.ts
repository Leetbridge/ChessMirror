import { readdirSync } from "node:fs";
import path from "node:path";
import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import {
  FIXTURES_DIR,
  loadManifest,
  parseClkSeconds,
  rawHeaders,
  readFixture,
  splitGames,
  type GameExpectation,
} from "../fixtures/load";

/**
 * Golden tests: validate the declared properties of every synthetic fixture
 * using only chess.js. No src/ modules are imported.
 */

const manifest = loadManifest();

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function materialWhiteMinusBlack(chess: Chess): number {
  let sum = 0;
  for (const rank of chess.board()) {
    for (const piece of rank) {
      if (piece && piece.type !== "k") {
        sum += (piece.color === "w" ? 1 : -1) * (PIECE_VALUE[piece.type] ?? 0);
      }
    }
  }
  return sum;
}

interface Analysed {
  chess: Chess | null;
  /** Clock seconds by ply index (0-based); null where the ply has no clock. */
  clockByPly: (number | null)[];
  /** White-minus-black material after each ply. */
  leads: number[];
}

function analyse(gamePgn: string): Analysed {
  const chess = new Chess();
  try {
    chess.loadPgn(gamePgn);
  } catch {
    return { chess: null, clockByPly: [], leads: [] };
  }
  const moves = chess.history({ verbose: true });
  const commentByFen = new Map<string, string>();
  for (const c of chess.getComments()) commentByFen.set(c.fen, c.comment);

  const startFen = chess.getHeaders().FEN;
  const replay = startFen ? new Chess(startFen) : new Chess();
  const leads: number[] = [];
  const clockByPly: (number | null)[] = [];
  for (const mv of moves) {
    replay.move(mv.san);
    leads.push(materialWhiteMinusBlack(replay));
    const comment = commentByFen.get(replay.fen());
    clockByPly.push(comment === undefined ? null : parseClkSeconds(comment));
  }
  return { chess, clockByPly, leads };
}

function clockClass(clocked: number, plies: number): "all" | "none" | "partial" {
  if (clocked === 0) return "none";
  return clocked === plies ? "all" : "partial";
}

function countRawClocks(gamePgn: string): number {
  return (gamePgn.match(/\[%clk /g) ?? []).length;
}

describe("fixture set integrity", () => {
  it("manifest lists exactly the .pgn files on disk", () => {
    const onDisk = readdirSync(path.join(FIXTURES_DIR, "pgn"))
      .filter((f) => f.endsWith(".pgn"))
      .map((f) => `pgn/${f}`)
      .sort();
    expect(manifest.files.map((f) => f.file).sort()).toEqual(onDisk);
  });

  it("covers the required scenarios", () => {
    const all = manifest.files.flatMap((f) => f.games);
    expect(all.some((g) => g.plies !== null && g.plies < 10 && g.plies > 0)).toBe(true);
    expect(all.some((g) => g.result === "*" && g.plies === 0)).toBe(true);
    expect(all.some((g) => g.clocks === "all")).toBe(true);
    expect(all.some((g) => g.clocks === "none")).toBe(true);
    expect(all.some((g) => g.clocks === "partial")).toBe(true);
    expect(all.some((g) => g.variant === "Chess960")).toBe(true);
    expect(all.some((g) => g.termination === "Time forfeit")).toBe(true);
    expect(all.some((g) => g.termination?.includes("resignation"))).toBe(true);
    expect(all.some((g) => g.endsInCheckmate)).toBe(true);
    expect(manifest.files.some((f) => f.games.length > 1)).toBe(true);
  });

  it("every game is labelled synthetic", () => {
    for (const f of manifest.files) {
      for (const g of splitGames(readFixture(f.file))) {
        expect(rawHeaders(g).Event, f.file).toMatch(/^Synthetic/);
      }
    }
  });
});

describe.each(manifest.files)("$file", (entry) => {
  const games = splitGames(readFixture(entry.file));

  it("has the declared number of games", () => {
    expect(games).toHaveLength(entry.games.length);
  });

  describe.each(entry.games.map((expected, i) => ({ expected, i })))("game $i", ({ expected, i }) => {
    const pgn = games[i] ?? "";
    const raw = rawHeaders(pgn);
    const analysed = analyse(pgn);

    it("declares result, variant, termination and time control in its tags", () => {
      expect(raw.Result).toBe(expected.result);
      expect(raw.Variant ?? null).toBe(expected.variant);
      expect(raw.Termination ?? null).toBe(expected.termination);
      expect(raw.TimeControl ?? null).toBe(expected.timeControl);
    });

    it(`chess.js ${expected.chessJsParses ? "parses" : "rejects"} the game`, () => {
      expect(analysed.chess !== null).toBe(expected.chessJsParses);
    });

    it("clock presence matches the declaration", () => {
      const rawCount = countRawClocks(pgn);
      expect(rawCount).toBe(expected.clockedPlies);
      if (analysed.chess) {
        const parsed = analysed.clockByPly.filter((c) => c !== null).length;
        expect(parsed).toBe(expected.clockedPlies);
        expect(clockClass(parsed, analysed.clockByPly.length)).toBe(expected.clocks);
      }
    });

    it("ply count, result and checkmate flag match", () => {
      const chess = analysed.chess;
      if (!chess) {
        expect(expected.plies).toBeNull();
        return;
      }
      expect(chess.history()).toHaveLength(expected.plies ?? -1);
      expect(chess.getHeaders().Result).toBe(expected.result);
      expect(chess.isCheckmate()).toBe(expected.endsInCheckmate);
    });

    it("checkmate games carry a matching decisive result", () => {
      const chess = analysed.chess;
      if (!chess || !expected.endsInCheckmate) return;
      // Side to move is mated, so the other side won.
      expect(expected.result).toBe(chess.turn() === "b" ? "1-0" : "0-1");
    });

    if (expected.headers) {
      const headers = expected.headers;
      it("preserves odd header values exactly", () => {
        for (const [k, v] of Object.entries(headers)) {
          expect(raw[k]).toBe(v);
          expect(analysed.chess?.getHeaders()[k]).toBe(v);
        }
      });
    }

    if (expected.clockHasTenths) {
      it("uses tenths in clock values", () => {
        expect(pgn).toMatch(/\[%clk \d+:\d{2}:\d{2}\.\d\]/);
      });
    }

    if (expected.hasEvalComments) {
      it("carries [%eval] alongside [%clk] in the same comment", () => {
        expect(pgn).toMatch(/\{ \[%eval [^\]]+\] \[%clk [^\]]+\] \}/);
      });
    }

    if (expected.variant !== null) {
      it("is a variant game that must be skipped by tag", () => {
        expect(expected.variant).not.toBe("Standard");
        expect(raw.Variant).toBeDefined();
      });
    }

    scenarioTests(expected, analysed);
  });
});

function scenarioTests(expected: GameExpectation, analysed: Analysed): void {
  const { hero } = expected;

  if (expected.heroClockUnder10FromPly !== undefined && hero) {
    const from = expected.heroClockUnder10FromPly;
    it("hero enters time trouble (<10s) at the declared ply and stays there", () => {
      const parity = hero === "w" ? 0 : 1;
      analysed.clockByPly.forEach((clk, idx) => {
        if (idx % 2 !== parity || clk === null) return;
        if (idx + 1 < from) expect(clk, `ply ${idx + 1}`).toBeGreaterThanOrEqual(10);
        else expect(clk, `ply ${idx + 1}`).toBeLessThan(10);
      });
      const heroClocks = analysed.clockByPly.filter((c, idx) => idx % 2 === parity && c !== null) as number[];
      expect(Math.min(...heroClocks)).toBe(expected.heroMinClockSec);
    });
  }

  if (expected.heroBlunderPly !== undefined && hero) {
    const ply = expected.heroBlunderPly;
    it("hero's declared blunder loses at least a queen's worth of material", () => {
      const before = analysed.leads[ply - 2] ?? 0;
      // The declared blunder is followed by the capture, so look two plies on.
      const after = analysed.leads[ply] ?? 0;
      const sign = hero === "w" ? 1 : -1;
      expect(sign * (after - before)).toBeLessThanOrEqual(-6);
    });
  }

  if (expected.materialLead && hero) {
    const m = expected.materialLead;
    it("material swing matches (pieces only, P1 N3 B3 R5 Q9)", () => {
      const sign = m.hero === "w" ? 1 : -1;
      const heroLeads = analysed.leads.map((l) => sign * l);
      expect(Math.max(...heroLeads, 0)).toBe(m.peak);
      expect(heroLeads.at(-1)).toBe(m.final);
      if (m.peakPly !== undefined) expect(heroLeads[m.peakPly - 1]).toBe(m.peak);
    });
  }

  if (expected.heroDeficitAtLeast5FromPly !== undefined && hero) {
    const from = expected.heroDeficitAtLeast5FromPly;
    it("hero is lost from the declared ply, keeps playing and never resigns", () => {
      const sign = hero === "w" ? 1 : -1;
      const heroLeads = analysed.leads.map((l) => sign * l);
      // Never recovers after the declared ply.
      heroLeads.slice(from - 1).forEach((l, k) => expect(l, `ply ${from + k}`).toBeLessThanOrEqual(-5));
      expect(heroLeads.slice(0, from - 1).every((l) => l > -5)).toBe(true);
      // Hero keeps making moves until the game ends by checkmate against them.
      const total = analysed.leads.length;
      const heroParity = hero === "w" ? 1 : 0; // 1-based ply parity of hero moves
      let heroMovesAfter = 0;
      for (let ply = from + 1; ply <= total; ply++) if (ply % 2 === heroParity) heroMovesAfter++;
      expect(heroMovesAfter).toBe(expected.heroMovesAfterLost);
      expect(expected.endsInCheckmate).toBe(true);
      expect(analysed.chess?.turn()).toBe(hero);
    });
  }
}

describe("harness sanity (negative controls)", () => {
  it("chess.js rejects an illegal move, so 'parses' really means 'legal'", () => {
    const chess = new Chess();
    expect(() => chess.loadPgn('[Result "*"]\n\n1. e4 e5 2. Ke3 *\n')).toThrow();
  });

  it("splitGames does not merge a bare '*' game with the next game", () => {
    const text = '[Event "a"]\n[Result "*"]\n\n*\n\n[Event "b"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n';
    expect(splitGames(text)).toHaveLength(2);
  });
});

describe("large PGN handling", () => {
  it("splits and parses a 2500-game concatenation of the multi-game fixture", () => {
    const one = readFixture("pgn/multi_game.pgn").trim();
    const big = Array.from({ length: 500 }, () => one).join("\n\n\n");
    const games = splitGames(big);
    expect(games).toHaveLength(2500);
    let parsed = 0;
    let rejected = 0;
    for (const g of games) {
      const c = new Chess();
      try {
        c.loadPgn(g);
        parsed++;
      } catch {
        rejected++;
      }
    }
    // Per copy: 4 parseable games and 1 Crazyhouse game chess.js rejects.
    expect(parsed).toBe(2000);
    expect(rejected).toBe(500);
  });
});
