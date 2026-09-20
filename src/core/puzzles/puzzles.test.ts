import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqlitePuzzleStore } from "../store";
import { buildPuzzleIndex, findUnknownThemes, getPuzzlesByTheme, listThemes, parsePuzzleLine } from "./index";

const lines = readFileSync(new URL("./fixtures/sample.csv", import.meta.url), "utf8").split("\n");

describe("parsePuzzleLine", () => {
  it("parses a real Lichess row", () => {
    const p = parsePuzzleLine(lines[1] as string);
    expect(p).toEqual({
      id: "00sHx",
      fen: "q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17",
      moves: ["e8d7", "a2e6", "d7d8", "f7f8"],
      rating: 1760,
      popularity: 83,
      nbPlays: 72,
      themes: ["mate", "mateIn2", "middlegame", "short"],
    });
  });
  it("rejects wrong column counts, non-numeric ratings and quoted fields", () => {
    expect(parsePuzzleLine("bad01,too,few,columns")).toBeUndefined();
    expect(parsePuzzleLine(lines[7] as string)).toBeUndefined();
    expect(parsePuzzleLine(`${lines[1]}"`)).toBeUndefined();
  });
});

describe("buildPuzzleIndex + queries", () => {
  const build = async (opts = {}) => {
    const store = createSqlitePuzzleStore(":memory:");
    const stats = await buildPuzzleIndex(lines, store, opts);
    return { store, stats };
  };

  it("indexes in-range rows and reports skipped ones", async () => {
    const { store, stats } = await build();
    expect(stats).toMatchObject({ rowsRead: 7, malformed: 2, outOfRange: 2, written: 3 });
    expect(store.count()).toBe(3);
  });

  it("queries by theme with rating range and limit", async () => {
    const { store } = await build();
    expect(getPuzzlesByTheme(store, ["fork"]).map((p) => p.id)).toEqual(["00sJb"]);
    expect(getPuzzlesByTheme(store, ["advantage", "mate"]).map((p) => p.id)).toEqual(["00sJb", "00sO1", "00sHx"]);
    expect(getPuzzlesByTheme(store, ["advantage", "mate"], { limit: 2 })).toHaveLength(2);
    expect(getPuzzlesByTheme(store, ["advantage"], { ratingRange: { max: 1500 } }).map((p) => p.id)).toEqual(["00sO1"]);
    expect(getPuzzlesByTheme(store, ["advantage"], { ratingRange: { min: 3000 } })).toEqual([]);
    const wide = (await build({ ratingMax: 3000 })).store;
    expect(getPuzzlesByTheme(wide, ["fork"]).map((p) => p.id)).toEqual(["00sJb", "00sJ9"]);
    expect(getPuzzlesByTheme(store, [])).toEqual([]);
    expect(() => getPuzzlesByTheme(store, ["fork"], { limit: 0 })).toThrow();
    expect(() => getPuzzlesByTheme(store, ["fork"], { ratingRange: { min: 2000, max: 1000 } })).toThrow();
  });

  it("lists themes and finds unknown ones", async () => {
    const { store } = await build();
    expect(listThemes(store).find((t) => t.theme === "advantage")?.count).toBe(2);
    expect(findUnknownThemes(store, ["fork", "notATheme", "notATheme"])).toEqual(["notATheme"]);
  });

  it("honours perTheme, maxTotal and maxRows", async () => {
    const perTheme = await build({ perTheme: 1 });
    // top-1 per theme keeps the most popular puzzle of each theme.
    expect(getPuzzlesByTheme(perTheme.store, ["fork"]).map((p) => p.id)).toEqual(["00sJb"]);
    const one = await build({ perTheme: 1, ratingMax: 3000 });
    expect(one.store.find({ themes: ["attraction"], limit: 5 }).map((p) => p.id)).toEqual(["00sJ9"]);
    const capped = await build({ maxTotal: 2, ratingMax: 3000 });
    expect(capped.store.count()).toBe(2);
    const partial = await build({ maxRows: 2, ratingMax: 3000 });
    expect(partial.stats.rowsRead).toBe(2);
    expect(partial.store.count()).toBe(2);
  });

  it("refuses an unexpected header", async () => {
    const store = createSqlitePuzzleStore(":memory:");
    await expect(buildPuzzleIndex(["a,b,c", "x"], store)).rejects.toThrow(/header/);
  });
});
