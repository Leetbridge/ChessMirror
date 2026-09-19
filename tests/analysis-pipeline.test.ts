import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyGame, getPositions } from "../src/core/classify";
import { UciEngine } from "../src/core/engine";
import type { EngineAnalyzer } from "../src/core/engine";
import { parsePgnText } from "../src/core/import";
import type { Game } from "../src/core/domain";

/** The wiring src/app will do: import -> engine on each non-terminal position -> classify. */
async function analyze(game: Game, engine: EngineAnalyzer, depth: number, engineName?: string) {
  const evals = [];
  for (const p of getPositions(game)) evals.push(p.terminal ? null : await engine.analyze(p.fen, { depth }));
  return classifyGame(game, evals, engineName ? { engineName } : {});
}

const fixture = () =>
  parsePgnText(readFileSync(join(process.cwd(), "tests/fixtures/lichess-export.pgn"), "utf8"), {
    source: "lichess",
    username: "Hero",
  }).games;

describe("import -> engine -> classify with a scripted engine", () => {
  it("runs end to end and never calls the engine on the mated position", async () => {
    const seen: string[] = [];
    const engine: EngineAnalyzer = {
      analyze: async (fen) => {
        seen.push(fen);
        return { evalCp: 0, depth: 8, bestMoveUci: "e2e4" };
      },
      close: async () => {},
    };
    const game = fixture()[0]!; // 4-move-pair game ending in Qxf7#
    const a = await analyze(game, engine, 8);
    expect(a.moves).toHaveLength(7);
    expect(seen).toHaveLength(7); // 8 positions, the last is checkmate
    expect(a.moves[6]).toMatchObject({ mate: 0, winPct: 100, clockMs: 3772500 });
  });
});

describe.skipIf(!process.env["STOCKFISH_PATH"])("golden game with real Stockfish", () => {
  it("flags 3...Nf6?? (allows Qxf7#) as a blunder and Qxf7# as best", async () => {
    const engine = new UciEngine({ defaultDepth: 10 });
    try {
      const game = fixture()[0]!;
      const a = await analyze(game, engine, 10);
      const byPly = (n: number) => a.moves.find((m) => m.ply === n)!;
      expect(byPly(6)).toMatchObject({ san: "Nf6", class: "blunder" }); // Black's third move
      expect(byPly(7)).toMatchObject({ san: "Qxf7#", class: "best" });
      // The opening moves are sound.
      expect(["best", "good"]).toContain(byPly(1).class);
      expect(a.moves.slice(0, 5).every((m) => m.class !== "blunder")).toBe(true);
      expect(engine.name).toMatch(/stockfish/i);
    } finally {
      await engine.close();
    }
  }, 60_000);
});
