import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EngineNotFoundError } from "../src/core/engine";
import { detectHabits } from "../src/core/habits";
import { HttpError, splitPgn } from "../src/core/import";
import { inferHero, readConfig, runPipeline, toUserMessage, type PipelineDeps } from "../src/app/lib/pipeline";
import { MAX_PGN_FILE_BYTES, readPgnFile } from "../src/app/lib/pgn-file";
import { createRealService } from "../src/app/lib/real-service";
import { ResultSchema, ServiceBusyError, type JobState, type Progress } from "../src/app/lib/types";
import { readFixture } from "./fixtures/load";

import { FakeEngine, copies, fakeFetch } from "./helpers";

const config = readConfig({});

function deps(engine: FakeEngine, f: ReturnType<typeof fakeFetch>, extra: Partial<PipelineDeps> = {}): PipelineDeps {
  return { config, env: {}, fetch: f.fetch, createEngine: () => engine, ...extra };
}

describe("runPipeline with a fake engine and fixture PGNs", () => {
  it("produces a schema-valid result and feeds detectors real AnalyzedGames", async () => {
    const engine = new FakeEngine();
    const f = fakeFetch(copies("pgn/winning_position_thrown_away.pgn", 6));
    const progress: Progress[] = [];
    const out = await runPipeline(
      { source: "lichess", username: "SyntheticHero" },
      deps(engine, f, { onProgress: (p) => progress.push(p) }),
    );

    // Output validates against the schema the UI uses.
    expect(ResultSchema.safeParse(out.result).success).toBe(true);
    expect(out.result.gamesAnalyzed).toBe(6);
    expect(out.analyzed).toHaveLength(6);

    // The games are real classifier output built from engine evals.
    const a = out.analyzed[0]!;
    expect(a.engine).toMatchObject({ name: "FakeFish 1", depth: 12 });
    expect(a.moves.length).toBeGreaterThan(20);
    expect(a.moves.every((m) => m.clockMs !== undefined)).toBe(true);
    expect(engine.calls.every((c) => c.depth === 12 || c.depth === 1)).toBe(true);

    // Detectors ran on exactly those games: same findings, evidence points at real plies.
    const direct = detectHabits(out.analyzed);
    expect(out.result.findings.map((x) => [x.detector, x.status])).toEqual(direct.map((x) => [x.detector, x.status]));
    const thrown = out.result.findings.find((x) => x.detector === "thrown-wins");
    expect(thrown?.status).toBe("detected");
    if (thrown?.status === "detected") {
      const ids = new Set(out.analyzed.map((g) => g.game.id));
      for (const ev of thrown.evidence) {
        expect(ids.has(ev.gameId)).toBe(true);
        expect(out.analyzed.find((g) => g.game.id === ev.gameId)?.moves.some((m) => m.ply === ev.ply)).toBe(true);
      }
      expect(out.result.plan.findingIds).toContain(thrown.id);
    }
    expect(out.coachSource).toBe("template"); // no ANTHROPIC_API_KEY in env

    // Import: one request, bounded by maxGames; progress reported per game; engine closed.
    expect(f.urls).toHaveLength(1);
    expect(f.urls[0]).toContain("/api/games/user/SyntheticHero");
    expect(f.urls[0]).toContain("max=50");
    expect(progress.filter((p) => p.stage === "engine").map((p) => p.done)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(progress[progress.length - 1]).toEqual({ stage: "plan", done: 1, total: 1 });
    expect(engine.closed).toBe(true);
  });

  it("returns an empty valid result when there are no games", async () => {
    const engine = new FakeEngine();
    const out = await runPipeline({ source: "lichess", username: "nobody" }, deps(engine, fakeFetch("")));
    expect(ResultSchema.safeParse(out.result).success).toBe(true);
    expect(out.result.gamesAnalyzed).toBe(0);
    expect(engine.closed).toBe(true);
  });

  it("analyzes pasted PGN, inferring the user as the most frequent player", async () => {
    const pgn = readFixture("lichess-export.pgn");
    expect(inferHero(pgn)?.toLowerCase()).toBe("hero");
    const engine = new FakeEngine();
    const out = await runPipeline({ source: "pgn", pgn }, deps(engine, fakeFetch("")));
    expect(out.result.gamesAnalyzed).toBeGreaterThan(0);
    expect(ResultSchema.safeParse(out.result).success).toBe(true);
    expect(out.result.assumedPlayer?.toLowerCase()).toBe("hero");
    // Named-user imports never carry an assumption.
    const named = await runPipeline({ source: "lichess", username: "abc" }, deps(new FakeEngine(), fakeFetch("")));
    expect(named.result.assumedPlayer).toBeUndefined();
  });

  it("splitPgn stays linear on long blank-line runs", () => {
    const t = Date.now();
    expect(splitPgn('[Event "x"]\n' + "\n".repeat(300_000) + '1. e4 *\n\n[Event "y"]\n\n1. d4 *')).toHaveLength(2);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("caps games at maxGames", async () => {
    const engine = new FakeEngine();
    const f = fakeFetch("");
    await runPipeline({ source: "lichess", username: "abc" }, deps(engine, f, { config: { ...config, maxGames: 7 } }));
    expect(f.urls[0]).toContain("max=7");
  });
});

describe("user-facing errors", () => {
  it("fails fast with a Stockfish message before touching the network", async () => {
    const f = fakeFetch("");
    const engine = new FakeEngine();
    engine.analyze = async () => {
      throw new EngineNotFoundError("nope");
    };
    const err = await runPipeline({ source: "lichess", username: "abc" }, deps(engine, f)).catch((e: unknown) => e);
    expect(toUserMessage(err, "lichess")).toMatch(/STOCKFISH_PATH/);
    expect(f.urls).toHaveLength(0);
    expect(engine.closed).toBe(true);
  });

  it("maps a 404 to 'username not found' and still closes the engine", async () => {
    const engine = new FakeEngine();
    const err = await runPipeline({ source: "lichess", username: "ghost1" }, deps(engine, fakeFetch("", 404))).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect(toUserMessage(err, "lichess")).toBe("Username not found on Lichess.");
    expect(toUserMessage(err, "chesscom")).toBe("Username not found on chess.com.");
    expect(engine.closed).toBe(true);
  });

  it("requires CHESSCOM_USER_AGENT for chess.com", async () => {
    const engine = new FakeEngine();
    const err = await runPipeline({ source: "chesscom", username: "abc" }, deps(engine, fakeFetch(""))).catch(
      (e: unknown) => e,
    );
    expect(toUserMessage(err, "chesscom")).toMatch(/CHESSCOM_USER_AGENT/);
  });
});

describe("real service", () => {
  const settle = async (get: () => Promise<JobState | undefined>) => {
    for (let i = 0; i < 200; i++) {
      const s = await get();
      if (s && s.state !== "running") return s;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("job did not finish");
  };

  it("runs one job at a time and reports done with a schema-valid result", async () => {
    const engine = new FakeEngine();
    const f = fakeFetch(copies("pgn/winning_position_thrown_away.pgn", 3));
    const svc = createRealService(() => deps(engine, f));
    const { id } = await svc.start({ source: "lichess", username: "SyntheticHero" });
    await expect(svc.start({ source: "lichess", username: "SyntheticHero" })).rejects.toBeInstanceOf(ServiceBusyError);
    const s = await settle(() => svc.get(id));
    expect(s.state).toBe("done");
    if (s.state === "done") expect(ResultSchema.safeParse(s.result).success).toBe(true);
    expect(engine.closed).toBe(true);
    // A new job is allowed once the first has finished.
    await expect(svc.start({ source: "lichess", username: "SyntheticHero" })).resolves.toHaveProperty("id");
    expect(await svc.get("missing")).toBeUndefined();
  });

  it("reports a clear error state", async () => {
    const svc = createRealService(() => deps(new FakeEngine(), fakeFetch("", 404)));
    const { id } = await svc.start({ source: "lichess", username: "ghost1" });
    const s = await settle(() => svc.get(id));
    expect(s).toEqual({ state: "error", message: "Username not found on Lichess." });
  });
});

describe("readPgnFile", () => {
  it("accepts a small regular file and rejects missing, directory and oversized paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-pgn-"));
    try {
      const ok = join(dir, "a.pgn");
      writeFileSync(ok, "[Event \"x\"]\n\n1. e4 *\n");
      expect(readPgnFile(ok)).toContain("e4");
      expect(() => readPgnFile(join(dir, "missing.pgn"))).toThrow("Could not read the PGN file. Check the path and permissions.");
      expect(() => readPgnFile(dir)).toThrow("not a regular file");
      const big = join(dir, "big.pgn");
      writeFileSync(big, Buffer.alloc(MAX_PGN_FILE_BYTES + 1, 97));
      expect(() => readPgnFile(big)).toThrow("larger than");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
