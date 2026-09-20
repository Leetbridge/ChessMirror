import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalyzedGame, Finding, Game, Plan, Puzzle } from "../domain";
import { createSqlitePuzzleStore, createSqliteRepository } from "./index";

const game: Game = {
  id: "lichess:abc123",
  source: "lichess",
  playedAt: "2026-01-02T03:04:05Z",
  white: { name: "me", rating: 1500 },
  black: { name: "them" },
  userColor: "white",
  result: "white",
  moves: [
    { ply: 1, san: "e4", uci: "e2e4" },
    { ply: 2, san: "e5", uci: "e7e5", clockMs: 59000 },
  ],
};
const { moves: _m, ...header } = game;
void _m;
const analyzed: AnalyzedGame = {
  game: header,
  moves: [{ ply: 1, san: "e4", uci: "e2e4", evalCp: 20, winPct: 51, class: "best" }],
  engine: { depth: 12 },
  analyzedAt: "2026-01-02T03:04:05Z",
};
const drill = (kind: "chess" | "soft_skill") => ({ id: `d-${kind}`, kind, title: "t", description: "d" });
const finding: Finding = {
  id: "f1",
  detector: "time-trouble-blunders",
  status: "detected",
  evidence: [{ gameId: game.id, ply: 31 }],
  severity: "high",
  confidence: 0.7,
  explanation: "Consistent with time pressure.",
  chessDrill: drill("chess"),
  softSkillDrill: drill("soft_skill"),
};
const plan = (id: string, createdAt: string): Plan => ({
  id,
  createdAt,
  findingIds: ["f1"],
  chessDrills: [drill("chess")],
  softSkillDrills: [drill("soft_skill")],
  puzzleThemes: ["fork"],
});

describe("SQLite Repository (in-memory)", () => {
  it("round-trips games and upserts by id", async () => {
    const repo = createSqliteRepository(":memory:");
    await repo.saveGames([game]);
    expect(await repo.getGame(game.id)).toEqual(game);
    expect(await repo.getGame("nope")).toBeUndefined();
    await repo.saveGames([{ ...game, result: "draw" }, { ...game, id: "lichess:z", playedAt: "2026-02-01T00:00:00Z" }]);
    const all = await repo.listGames();
    expect(all.map((g) => g.id)).toEqual(["lichess:z", "lichess:abc123"]); // newest first
    expect(all[1]?.result).toBe("draw");
    await repo.close();
  });

  it("round-trips analyzed games, findings and plans", async () => {
    const repo = createSqliteRepository(":memory:");
    await repo.saveAnalyzedGame(analyzed);
    expect(await repo.getAnalyzedGame(game.id)).toEqual(analyzed);
    expect(await repo.listAnalyzedGames()).toEqual([analyzed]);
    await repo.saveFindings([finding, { id: "f2", detector: "x", status: "insufficient_data", reason: "few games" }]);
    expect((await repo.listFindings()).map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(await repo.getLatestPlan()).toBeUndefined();
    await repo.savePlan(plan("p1", "2026-01-01T00:00:00Z"));
    await repo.savePlan(plan("p2", "2026-03-01T00:00:00Z"));
    await repo.savePlan(plan("p3", "2026-02-01T00:00:00Z"));
    expect((await repo.getLatestPlan())?.id).toBe("p2");
    await repo.close();
  });

  it("rejects invalid data before writing", async () => {
    const repo = createSqliteRepository(":memory:");
    await expect(repo.saveGames([{ ...game, source: "other" } as unknown as Game])).rejects.toThrow();
    expect(await repo.listGames()).toEqual([]);
    await repo.close();
  });

  it("treats hostile ids as data (parameterized queries)", async () => {
    const repo = createSqliteRepository(":memory:");
    await repo.saveGames([game]);
    expect(await repo.getGame("x' OR '1'='1")).toBeUndefined();
    expect(await repo.getGame("'; DROP TABLE games; --")).toBeUndefined();
    expect(await repo.listGames()).toHaveLength(1);
    await repo.close();
  });
});

describe("SQLite Repository (temp file)", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("persists across reopen and is idempotent on migrations", async () => {
    dir = mkdtempSync(join(tmpdir(), "cm-store-"));
    const path = join(dir, "t.db");
    const a = createSqliteRepository(path);
    await a.saveGames([game]);
    await a.close();
    const b = createSqliteRepository(path);
    expect(await b.getGame(game.id)).toEqual(game);
    await b.close();
  });
});

const puzzle = (id: string, rating: number, popularity: number, themes: string[]): Puzzle => ({
  id,
  fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
  moves: ["a1a2", "h1h2"],
  rating,
  popularity,
  nbPlays: 10,
  themes,
});

describe("SQLite PuzzleStore", () => {
  it("finds by any theme, filters rating, orders by popularity, and lists themes", () => {
    const s = createSqlitePuzzleStore(":memory:");
    s.insertMany([
      puzzle("a", 1000, 50, ["fork", "short"]),
      puzzle("b", 1500, 90, ["fork"]),
      puzzle("c", 2000, 70, ["pin"]),
      puzzle("d", 1200, 10, ["mate"]),
    ]);
    expect(s.count()).toBe(4);
    expect(s.find({ themes: ["fork", "pin"], limit: 10 }).map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(s.find({ themes: ["fork", "pin"], ratingMin: 1100, ratingMax: 1800, limit: 10 }).map((p) => p.id)).toEqual(["b"]);
    expect(s.find({ themes: ["fork", "pin"], limit: 1 })).toHaveLength(1);
    expect(s.find({ themes: [], limit: 5 })).toEqual([]);
    expect(s.find({ themes: ["' OR 1=1 --"], limit: 5 })).toEqual([]);
    expect(s.listThemes()).toEqual([
      { theme: "fork", count: 2 },
      { theme: "mate", count: 1 },
      { theme: "pin", count: 1 },
      { theme: "short", count: 1 },
    ]);
    const first = s.find({ themes: ["short"], limit: 1 })[0];
    expect(first).toEqual(puzzle("a", 1000, 50, ["fork", "short"]));
    s.close();
  });

  it("re-inserting a puzzle replaces its themes", () => {
    const s = createSqlitePuzzleStore(":memory:");
    s.insertMany([puzzle("a", 1000, 50, ["fork"])]);
    s.insertMany([puzzle("a", 1000, 50, ["pin"])]);
    expect(s.count()).toBe(1);
    expect(s.find({ themes: ["fork"], limit: 5 })).toEqual([]);
    expect(s.find({ themes: ["pin"], limit: 5 })).toHaveLength(1);
    s.close();
  });
});
