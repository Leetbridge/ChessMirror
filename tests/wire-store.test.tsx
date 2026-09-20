import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPuzzleIndex } from "../src/core/puzzles";
import { createSqlitePuzzleStore, createSqliteRepository } from "../src/core/store";
import type { PuzzleStore } from "../src/core/store";
import { PlanContent } from "../src/app/components/PlanView";
import { readConfig, runPipeline, type PipelineDeps } from "../src/app/lib/pipeline";
import { attachPuzzles, estimateRating } from "../src/app/lib/puzzles";
import { createRealService, envDeps } from "../src/app/lib/real-service";
import {
  createFileResultStore,
  MAX_RESULT_FILES,
  openPuzzleStore,
  openRepository,
} from "../src/app/lib/storage";
import { ResultSchema, type JobState } from "../src/app/lib/types";
import { FakeEngine, copies, fakeFetch } from "./helpers";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cm-wire-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function buildTinyPuzzleDb(path: string): Promise<void> {
  const csv = readFileSync(join(process.cwd(), "src/core/puzzles/fixtures/sample.csv"), "utf8").split("\n");
  const store = createSqlitePuzzleStore(path);
  await buildPuzzleIndex(csv, store);
  store.close();
}

const PGN = () => copies("pgn/winning_position_thrown_away.pgn", 6);
const request = { source: "lichess", username: "SyntheticHero" } as const;

describe("storage helpers", () => {
  it("falls back to in-memory with a log line when the database cannot be opened", async () => {
    const blocker = join(dir, "file");
    writeFileSync(blocker, "x");
    const logs: string[] = [];
    const repo = openRepository(join(blocker, "sub", "db.sqlite"), (m) => logs.push(m));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/in-memory/);
    await repo.saveFindings([]);
    expect(await repo.listFindings()).toEqual([]);
  });

  it("returns undefined for a missing puzzle database", () => {
    expect(openPuzzleStore(join(dir, "nope.db"))).toBeUndefined();
  });

  it("result store rejects ids that are not UUIDs (no path traversal)", () => {
    const rs = createFileResultStore(join(dir, "db.sqlite"))!;
    expect(rs.load("../../etc/passwd")).toBeUndefined();
    expect(rs.load("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });
});

describe("persistence across restart", () => {
  it("stores games, analysis and plan in SQLite and serves the finished result from a new service", async () => {
    const dbPath = join(dir, "chessmirror.db");
    const engine = new FakeEngine();
    const f = fakeFetch(PGN());
    const mk = (): PipelineDeps => ({
      ...envDeps({ DATABASE_PATH: dbPath, PUZZLES_DATABASE_PATH: join(dir, "none.db") }),
      fetch: f.fetch,
      createEngine: () => engine,
    });

    const svc1 = createRealService(mk, Date.now, createFileResultStore(dbPath) ?? null);
    const { id } = await svc1.start(request);
    let s: JobState | undefined;
    for (let i = 0; i < 400 && (!s || s.state === "running"); i++) {
      await new Promise((r) => setTimeout(r, 10));
      s = await svc1.get(id);
    }
    expect(s?.state).toBe("done");

    // "Restart": a brand new service with an empty job map reads the persisted result.
    const svc2 = createRealService(mk, Date.now, createFileResultStore(dbPath) ?? null);
    const again = await svc2.get(id);
    expect(again).toEqual(s);
    if (again?.state === "done") {
      expect(ResultSchema.safeParse(again.result).success).toBe(true);
      expect(again.result.puzzlesAvailable).toBe(false);
    }
    expect(await svc2.get("00000000-0000-4000-8000-000000000000")).toBeUndefined();

    // The repository file holds the analysis (and was closed cleanly: it reopens fine).
    const repo = createSqliteRepository(dbPath);
    expect(await repo.listAnalyzedGames()).toHaveLength(6);
    expect((await repo.getLatestPlan())?.chessDrills.length).toBeGreaterThan(0);
    await repo.close();
  });
});

describe("puzzles attached to the plan", () => {
  it("uses exactly each drill's puzzleThemes and validates against the schema", async () => {
    const puzzlesPath = join(dir, "puzzles.db");
    await buildTinyPuzzleDb(puzzlesPath);
    const store = openPuzzleStore(puzzlesPath)!;
    try {
      const out = await runPipeline(request, {
        config: readConfig({}),
        env: {},
        fetch: fakeFetch(PGN()).fetch,
        createEngine: () => new FakeEngine(),
        puzzleStore: store,
      });
      expect(ResultSchema.safeParse(out.result).success).toBe(true);
      expect(out.result.puzzlesAvailable).toBe(true);
      const drill = out.result.plan.chessDrills.find((d) => d.puzzleThemes?.includes("advantage"));
      expect(drill).toBeDefined();
      const got = out.result.drillPuzzles?.[drill!.id] ?? [];
      // Fixture puzzles with an "advantage" theme; each result carries one of the drill's themes.
      expect(got.map((p) => p.id).sort()).toEqual(["00sJb", "00sO1"]);
      for (const p of got) expect(p.themes.some((t) => drill!.puzzleThemes!.includes(t))).toBe(true);
      // Every drill key refers to a real chess drill in the plan.
      const drillIds = new Set(out.result.plan.chessDrills.map((d) => d.id));
      for (const k of Object.keys(out.result.drillPuzzles ?? {})) expect(drillIds.has(k)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("narrows by rating around the player's level and widens when nothing matches", async () => {
    const puzzlesPath = join(dir, "puzzles.db");
    await buildTinyPuzzleDb(puzzlesPath);
    const store = openPuzzleStore(puzzlesPath)!;
    try {
      const plan = {
        id: "p",
        createdAt: "2026-01-01T00:00:00.000Z",
        findingIds: [],
        chessDrills: [{ id: "d1", kind: "chess" as const, title: "t", description: "d", puzzleThemes: ["advantage"] }],
        softSkillDrills: [],
        puzzleThemes: ["advantage"],
      };
      expect(attachPuzzles(plan, store, 1000)["d1"]?.map((p) => p.id)).toEqual(["00sO1"]); // 998 within 700..1300
      expect(attachPuzzles(plan, store, 3000)["d1"]).toHaveLength(2); // window empty -> wide
      expect(attachPuzzles(plan, store, undefined)["d1"]).toHaveLength(2);
      expect(attachPuzzles({ ...plan, chessDrills: [{ ...plan.chessDrills[0]!, puzzleThemes: ["nonexistentTheme"] }] }, store, undefined)).toEqual({});
    } finally {
      store.close();
    }
  });

  it("estimates rating as the median of the user's own ratings", async () => {
    const out = await runPipeline(request, {
      config: readConfig({}),
      env: {},
      fetch: fakeFetch(PGN()).fetch,
      createEngine: () => new FakeEngine(),
    });
    const withRating = (r?: number) =>
      out.analyzed.map((a, i) => ({
        ...a,
        game: { ...a.game, white: { name: "SyntheticHero", ...(r !== undefined ? { rating: r + i * 10 } : {}) } },
      }));
    expect(estimateRating(withRating(1500))).toBe(1530);
    expect(estimateRating(withRating())).toBeUndefined();
  });
});

describe("plan view", () => {
  const plan = {
    id: "p",
    createdAt: "2026-01-01T00:00:00.000Z",
    findingIds: ["f"],
    chessDrills: [{ id: "d1", kind: "chess" as const, title: "Drill one", description: "d", puzzleThemes: ["fork"] }],
    softSkillDrills: [],
    puzzleThemes: ["fork"],
  };
  it("tells the user to run setup:puzzles when the database is missing", () => {
    expect(renderToStaticMarkup(<PlanContent plan={plan} puzzlesAvailable={false} />)).toContain("npm run setup:puzzles");
    expect(renderToStaticMarkup(<PlanContent plan={plan} />)).not.toContain("setup:puzzles");
  });
  it("shows puzzle id, rating, themes and the lichess training link", () => {
    const html = renderToStaticMarkup(
      <PlanContent
        plan={plan}
        puzzlesAvailable
        puzzles={{ d1: [{ id: "00sJb", fen: "x", moves: ["a1a2", "a2a3"], rating: 2235, themes: ["fork", "long"] }] }}
      />,
    );
    expect(html).toContain('href="https://lichess.org/training/00sJb"');
    expect(html).toContain("rating 2235");
    expect(html).toContain("long");
    expect(html).not.toContain("setup:puzzles");
  });
});

describe("result files: permissions and retention", () => {
  const result = { gamesAnalyzed: 0, findings: [], plan: { id: "p", createdAt: "2026-01-01T00:00:00.000Z", findingIds: [], chessDrills: [], softSkillDrills: [], puzzleThemes: [] } };
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("writes files 0600 in a 0700 directory and leaves no tmp file", () => {
    const rs = createFileResultStore(join(dir, "db.sqlite"))!;
    rs.save(uuid(1), result);
    const resultsDir = join(dir, "results");
    expect(statSync(resultsDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(resultsDir, `${uuid(1)}.json`)).mode & 0o777).toBe(0o600);
    expect(readdirSync(resultsDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(rs.load(uuid(1))).toEqual(result);
  });

  it("keeps at most maxFiles (newest) and deletes files older than maxAge", () => {
    expect(MAX_RESULT_FILES).toBe(200);
    const rs = createFileResultStore(join(dir, "db.sqlite"), () => {}, { maxFiles: 3, maxAgeMs: 10 * 86_400_000 })!;
    const resultsDir = join(dir, "results");
    const t0 = Date.now();
    for (let i = 1; i <= 5; i++) {
      rs.save(uuid(i), result);
      const when = new Date(t0 - (6 - i) * 1000); // i=5 newest
      utimesSync(join(resultsDir, `${uuid(i)}.json`), when, when);
    }
    rs.save(uuid(6), result); // triggers pruning: keeps the 3 newest of 6
    expect(readdirSync(resultsDir).sort()).toEqual([uuid(4), uuid(5), uuid(6)].map((u) => `${u}.json`));
    // Age rule
    const old = new Date(t0 - 40 * 86_400_000);
    utimesSync(join(resultsDir, `${uuid(4)}.json`), old, old);
    rs.save(uuid(7), result);
    expect(existsSync(join(resultsDir, `${uuid(4)}.json`))).toBe(false);
    expect(existsSync(join(resultsDir, `${uuid(7)}.json`))).toBe(true);
  });

  it("removes the tmp file when the rename fails and does not throw", () => {
    const logs: string[] = [];
    const rs = createFileResultStore(join(dir, "db.sqlite"), (m) => logs.push(m))!;
    rs.save(uuid(1), result);
    // Make the destination a directory so renameSync fails.
    const resultsDir = join(dir, "results");
    rmSync(join(resultsDir, `${uuid(2)}.json`), { force: true });
    mkdirSync(join(resultsDir, `${uuid(2)}.json`));
    rs.save(uuid(2), result);
    expect(logs).toHaveLength(1);
    expect(existsSync(join(resultsDir, `${uuid(2)}.json.tmp`))).toBe(false);
  });
});

describe("puzzle robustness", () => {
  const run = (puzzleStore: PuzzleStore) =>
    runPipeline(request, {
      config: readConfig({}),
      env: {},
      fetch: fakeFetch(PGN()).fetch,
      createEngine: () => new FakeEngine(),
      puzzleStore,
    });
  const store = (find: PuzzleStore["find"]): PuzzleStore => ({
    insertMany() {},
    find,
    listThemes: () => [],
    count: () => 0,
    close() {},
  });

  it("a corrupt puzzle database file is skipped with a log line", () => {
    const bad = join(dir, "bad.db");
    writeFileSync(bad, "this is not a sqlite database at all, just text".repeat(50));
    const logs: string[] = [];
    expect(openPuzzleStore(bad, (m) => logs.push(m))).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("a store that throws yields puzzlesAvailable:false, not a failed analysis", async () => {
    const out = await run(
      store(() => {
        throw new Error("SQLITE_CORRUPT");
      }),
    );
    expect(out.result.gamesAnalyzed).toBe(6);
    expect(out.result.puzzlesAvailable).toBe(false);
    expect(out.result.drillPuzzles).toBeUndefined();
    expect(ResultSchema.safeParse(out.result).success).toBe(true);
  });

  it("rows that fail the schema are dropped", async () => {
    const good = { id: "00sJb", fen: "x", moves: ["a1a2", "a2a3"], rating: 1500, popularity: 1, nbPlays: 1, themes: ["advantage"] };
    const out = await run(store(() => [good, { ...good, id: "bad id!" }, { ...good, id: "ok2", moves: ["a1a2"] }]));
    const all = Object.values(out.result.drillPuzzles ?? {}).flat();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => p.id === "00sJb")).toBe(true);
  });
});
