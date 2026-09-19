import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChessComSource, HttpError, LichessSource, parseClockMs, parsePgnText, parseTimeControl } from "./index";
import type { FetchLike } from "./index";

const fx = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures", name), "utf8");

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** Fake fetch: routes by URL, records calls, checks nothing overlaps (sequential requests). */
function fakeFetch(routes: (url: string, n: number) => Response) {
  const calls: Call[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    const res = routes(url, calls.length);
    inFlight--;
    return res;
  };
  return { f, calls, maxInFlight: () => maxInFlight };
}

const noSleep = async () => {};

describe("pgn helpers", () => {
  it("parses clocks", () => {
    expect(parseClockMs("{ [%clk 0:03:00] }")).toBe(180000);
    expect(parseClockMs("[%clk 0:02:55.9]")).toBe(175900);
    expect(parseClockMs("[%clk 1:02:52.5]")).toBe(3772500);
    expect(parseClockMs("no clock here")).toBeUndefined();
    expect(parseClockMs(undefined)).toBeUndefined();
  });
  it("parses time controls", () => {
    expect(parseTimeControl("180+2")).toEqual({ initialSec: 180, incrementSec: 2 });
    expect(parseTimeControl("600")).toEqual({ initialSec: 600, incrementSec: 0 });
    expect(parseTimeControl("1/86400")).toBeUndefined();
    expect(parseTimeControl("-")).toBeUndefined();
  });
});

describe("parsePgnText on the Lichess fixture", () => {
  const { games, skipped } = parsePgnText(fx("lichess-export.pgn"), { source: "lichess", username: "Hero" });

  it("keeps standard games, skips variants and aborted games", () => {
    expect(games.map((g) => g.id)).toEqual(["lichess:abcd1234", "lichess:blk00001"]);
    expect(skipped.map((s) => s.reason).sort()).toEqual(["no-moves", "variant"]);
  });
  it("maps headers", () => {
    const g = games[0]!;
    expect(g.userColor).toBe("white");
    expect(g.result).toBe("white");
    expect(g.playedAt).toBe("2026-04-08T19:39:03Z");
    expect(g.white).toEqual({ name: "Hero", rating: 1500 });
    expect(g.timeControl).toEqual({ initialSec: 180, incrementSec: 2 });
    expect(g.url).toBe("https://lichess.org/abcd1234");
    expect(g.termination).toBe("Normal");
  });
  it("extracts moves, uci and clocks", () => {
    const g = games[0]!;
    expect(g.moves.map((m) => m.san)).toEqual(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]);
    expect(g.moves[0]).toEqual({ ply: 1, san: "e4", uci: "e2e4", clockMs: 180000 });
    expect(g.moves[6]?.uci).toBe("h5f7");
    expect(g.moves[6]?.clockMs).toBe(3772500);
  });
  it("matches the username case-insensitively and handles black", () => {
    const g = games[1]!;
    expect(g.userColor).toBe("black");
    expect(g.moves.every((m) => m.clockMs === undefined)).toBe(true);
    expect(g.moves).toHaveLength(4);
  });
});

describe("parsePgnText edge cases", () => {
  it("skips games where the user did not play", () => {
    const r = parsePgnText(fx("lichess-export.pgn"), { source: "lichess", username: "nobody" });
    expect(r.games).toHaveLength(0);
  });
  it("skips invalid PGN without throwing", () => {
    const r = parsePgnText('[Event "x"]\n[White "a"]\n[Black "b"]\n\n1. e4 e4 2. Zz9 *', { source: "pgn", username: "a" });
    expect(r.games).toHaveLength(0);
    expect(r.skipped[0]?.reason).toBe("invalid-pgn");
  });
  it("handles a one-move game and promotion uci", () => {
    const pgn = '[Event "x"]\n[White "a"]\n[Black "b"]\n[Result "*"]\n\n1. e4 *';
    const r = parsePgnText(pgn, { source: "pgn", username: "a" });
    expect(r.games[0]?.moves).toHaveLength(1);
    expect(r.games[0]?.playedAt).toBe("1970-01-01T00:00:00Z");
  });
});

describe("LichessSource", () => {
  it("requests the documented endpoint and params with one request", async () => {
    const { f, calls } = fakeFetch(() => new Response(fx("lichess-export.pgn"), { status: 200 }));
    const src = new LichessSource({ fetch: f, sleep: noSleep, userAgent: "test-agent" });
    const games = await src.fetchGames({ username: "Hero", max: 50, since: "2026-01-01T00:00:00Z" });
    expect(games).toHaveLength(2);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/api/games/user/Hero");
    expect(u.searchParams.get("max")).toBe("50");
    expect(u.searchParams.get("since")).toBe(String(Date.parse("2026-01-01T00:00:00Z")));
    expect(u.searchParams.get("clocks")).toBe("true");
    expect(calls[0]!.headers["Accept"]).toBe("application/x-chess-pgn");
    expect(calls[0]!.headers["User-Agent"]).toBe("test-agent");
  });
  it("backs off on 429 and retries", async () => {
    const sleeps: number[] = [];
    const { f, calls } = fakeFetch((_u, n) =>
      n < 3 ? new Response("slow down", { status: 429 }) : new Response(fx("lichess-export.pgn"), { status: 200 }),
    );
    const src = new LichessSource({ fetch: f, sleep: async (ms) => void sleeps.push(ms) });
    const games = await src.fetchGames({ username: "Hero" });
    expect(games).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([60_000, 120_000]);
  });
  it("honours Retry-After and gives up after maxRetries", async () => {
    const sleeps: number[] = [];
    const { f, calls } = fakeFetch(() => new Response("", { status: 429, headers: { "retry-after": "5" } }));
    const src = new LichessSource({ fetch: f, sleep: async (ms) => void sleeps.push(ms), maxRetries: 2 });
    await expect(src.fetchGames({ username: "Hero" })).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBe(5000);
  });
  it("throws on other HTTP errors", async () => {
    const { f } = fakeFetch(() => new Response("", { status: 404 }));
    await expect(new LichessSource({ fetch: f }).fetchGames({ username: "x" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("ChessComSource", () => {
  const route = (url: string) => {
    if (url.endsWith("/games/archives")) return new Response(fx("chesscom-archives.json"));
    if (url.endsWith("/2026/01")) return new Response(fx("chesscom-2026-01.json"));
    if (url.endsWith("/2025/12")) return new Response(fx("chesscom-2025-12.json"));
    return new Response("", { status: 404 });
  };

  it("requires a User-Agent", () => {
    expect(() => new ChessComSource({ userAgent: " " })).toThrow(/User-Agent/);
  });
  it("walks archives sequentially, sends the UA, skips variants, newest first", async () => {
    const { f, calls, maxInFlight } = fakeFetch(route);
    const src = new ChessComSource({ fetch: f, sleep: noSleep, userAgent: "chessmirror-test (contact: t@example.com)" });
    const games = await src.fetchGames({ username: "Hero" });
    expect(games.map((g) => g.id)).toEqual(["chesscom:333", "chesscom:111", "chesscom:001"]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.chess.com/pub/player/hero/games/archives",
      "https://api.chess.com/pub/player/hero/games/2026/01",
      "https://api.chess.com/pub/player/hero/games/2025/12",
    ]);
    expect(calls.every((c) => c.headers["User-Agent"]?.includes("chessmirror-test"))).toBe(true);
    expect(maxInFlight()).toBe(1);
    const first = games.find((g) => g.id === "chesscom:111")!;
    expect(first.userColor).toBe("white");
    expect(first.moves[3]?.clockMs).toBe(170100);
    expect(first.timeControl).toEqual({ initialSec: 180, incrementSec: 0 });
    const daily = games.find((g) => g.id === "chesscom:333")!;
    expect(daily.timeControl).toBeUndefined();
    expect(daily.result).toBe("draw");
    expect(daily.userColor).toBe("black");
  });
  it("honours max and since", async () => {
    const a = fakeFetch(route);
    const src = new ChessComSource({ fetch: a.f, userAgent: "ua" });
    expect(await src.fetchGames({ username: "Hero", max: 1 })).toHaveLength(1);
    expect(a.calls).toHaveLength(2); // archives + newest month only

    const b = fakeFetch(route);
    const later = await new ChessComSource({ fetch: b.f, userAgent: "ua" }).fetchGames({
      username: "Hero",
      since: "2026-01-01T00:00:00Z",
    });
    expect(later.map((g) => g.id)).toEqual(["chesscom:333", "chesscom:111"]);
    expect(b.calls).toHaveLength(2); // 2025/12 never fetched
  });
  it("rejects malformed API payloads", async () => {
    const { f } = fakeFetch(() => new Response('{"nope":1}'));
    await expect(new ChessComSource({ fetch: f, userAgent: "ua" }).fetchGames({ username: "x" })).rejects.toThrow();
  });
  it("backs off on 429", async () => {
    const sleeps: number[] = [];
    const { f } = fakeFetch((u, n) => (n === 1 ? new Response("", { status: 429 }) : route(u)));
    const src = new ChessComSource({ fetch: f, sleep: async (ms) => void sleeps.push(ms), userAgent: "ua" });
    expect(await src.fetchGames({ username: "Hero" })).toHaveLength(3);
    expect(sleeps).toHaveLength(1);
  });
});
