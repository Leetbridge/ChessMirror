import { describe, expect, it } from "vitest";
import {
  ChessComSource,
  DEFAULT_MAX_GAMES,
  HttpError,
  LichessSource,
  MAX_GAMES,
  MAX_INPUT_CHARS,
  MAX_PLIES_PER_GAME,
  PgnLimitError,
  SAFE_ID_RE,
  getWithBackoff,
  parsePgnText,
  readTextCapped,
  splitPgn,
} from "./index";
import type { FetchLike } from "./index";

const pgn = (extra: string, moves = "1. e4 e5 *") =>
  `[Event "x"]\n[White "me"]\n[Black "you"]\n[Result "*"]\n${extra}\n\n${moves}`;
const ctx = { source: "pgn" as const, username: "me" };

describe("ChessComSource SSRF guard", () => {
  const src = (archives: string[], seen: string[]) => {
    const f: FetchLike = async (url) => {
      seen.push(url);
      return url.endsWith("/games/archives")
        ? new Response(JSON.stringify({ archives }))
        : new Response(JSON.stringify({ games: [] }));
    };
    return new ChessComSource({ fetch: f, userAgent: "ua" });
  };

  it.each([
    "https://evil.example.com/pub/player/hero/games/2026/01",
    "http://169.254.169.254/pub/player/hero/games/2026/01",
    "https://api.chess.com.evil.example.com/pub/player/hero/games/2026/01",
    "https://api.chess.com/private/admin",
    "https://api.chess.com:8443/pub/player/hero/games/2026/01",
    "not a url",
  ])("rejects %s without fetching it", async (bad) => {
    const seen: string[] = [];
    await expect(src([bad], seen).fetchGames({ username: "hero" })).rejects.toThrow(/archive URL/);
    expect(seen).toHaveLength(1); // only the archives list
  });

  it("accepts same-origin /pub/player/ archives", async () => {
    const seen: string[] = [];
    await src(["https://api.chess.com/pub/player/hero/games/2026/01"], seen).fetchGames({ username: "hero" });
    expect(seen).toHaveLength(2);
  });
});

describe("HTTP timeout and body cap", () => {
  it("passes an abort signal to fetch", async () => {
    let signal: AbortSignal | undefined;
    const f: FetchLike = async (_u, init) => {
      signal = init?.signal;
      return new Response("ok");
    };
    await getWithBackoff("https://x.test", {}, { fetch: f });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("times out a hung request", async () => {
    const f: FetchLike = (_u, init) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    await expect(getWithBackoff("https://x.test", {}, { fetch: f, timeoutMs: 20 })).rejects.toThrow(/abort/i);
  });

  it("rejects bodies over the cap by content-length and by streaming", async () => {
    await expect(
      readTextCapped(new Response("x".repeat(50), { headers: { "content-length": "50" } }), 10),
    ).rejects.toBeInstanceOf(HttpError);
    const streamed = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("x".repeat(8)));
          c.enqueue(new TextEncoder().encode("x".repeat(8)));
          c.close();
        },
      }),
    );
    await expect(readTextCapped(streamed, 10)).rejects.toThrow(/too large/);
    expect(await readTextCapped(new Response("hello"), 10)).toBe("hello");
  });

  it("sources enforce the body cap", async () => {
    const f: FetchLike = async () => new Response("x".repeat(100));
    await expect(new LichessSource({ fetch: f, maxBodyBytes: 10 }).fetchGames({ username: "u" })).rejects.toThrow(
      /too large/,
    );
    await expect(
      new ChessComSource({ fetch: f, userAgent: "ua", maxBodyBytes: 10 }).fetchGames({ username: "u" }),
    ).rejects.toThrow(/too large/);
  });
});

describe("default and maximum game counts", () => {
  it("Lichess sends max=200 by default and caps caller values at MAX_GAMES", async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => {
      urls.push(u);
      return new Response("");
    };
    const s = new LichessSource({ fetch: f });
    await s.fetchGames({ username: "u" });
    await s.fetchGames({ username: "u", max: 10_000_000 });
    expect(new URL(urls[0]!).searchParams.get("max")).toBe(String(DEFAULT_MAX_GAMES));
    expect(DEFAULT_MAX_GAMES).toBe(200);
    expect(new URL(urls[1]!).searchParams.get("max")).toBe(String(MAX_GAMES));
  });

  it("chess.com returns at most 200 games when no max is given", async () => {
    const game = (i: number) => ({
      rules: "chess",
      end_time: 1767283462 + i,
      pgn: `[Event "x"]\n[Site "Chess.com"]\n[White "hero"]\n[Black "r"]\n[Result "*"]\n[Link "https://www.chess.com/game/live/${i}"]\n\n1. e4 e5 *`,
    });
    const f: FetchLike = async (u) =>
      u.endsWith("/archives")
        ? new Response(JSON.stringify({ archives: ["https://api.chess.com/pub/player/hero/games/2026/01"] }))
        : new Response(JSON.stringify({ games: Array.from({ length: 250 }, (_, i) => game(i)) }));
    const games = await new ChessComSource({ fetch: f, userAgent: "ua" }).fetchGames({ username: "hero" });
    expect(games).toHaveLength(DEFAULT_MAX_GAMES);
  });
});

describe("PGN input limits", () => {
  it("rejects oversized input", () => {
    expect(() => splitPgn("x".repeat(MAX_INPUT_CHARS + 1))).toThrow(PgnLimitError);
    expect(() => parsePgnText("x".repeat(MAX_INPUT_CHARS + 1), ctx)).toThrow(PgnLimitError);
  });

  it("stops after MAX_GAMES games", () => {
    const many = Array.from({ length: MAX_GAMES + 5 }, () => pgn("")).join("\n\n").replaceAll('[White "me"]', '[Event "x"]\n[White "me"]');
    const r = parsePgnText(many, ctx);
    expect(r.games.length).toBeLessThanOrEqual(MAX_GAMES);
    expect(r.skipped.some((s) => s.reason === "over-limit")).toBe(true);
  });

  it("honours a smaller maxGames from the caller", () => {
    const three = [pgn(""), pgn(""), pgn("")].join("\n\n");
    const r = parsePgnText(three, { ...ctx, maxGames: 2 });
    expect(r.games).toHaveLength(2);
    expect(r.skipped[0]?.reason).toBe("over-limit");
  });

  it("skips games with more than MAX_PLIES_PER_GAME moves", () => {
    // Shuffle knights back and forth: legal, no repetition rule applied by the parser.
    const cycle = ["Nf3", "Nf6", "Ng1", "Ng8"];
    const sans: string[] = [];
    for (let i = 0; i < MAX_PLIES_PER_GAME + 4; i++) sans.push(cycle[i % 4]!);
    const moves = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ") + " *";
    const r = parsePgnText(pgn("", moves), ctx);
    expect(r.games).toHaveLength(0);
    expect(r.skipped[0]?.reason).toBe("too-long");
    const ok = parsePgnText(pgn("", "1. Nf3 Nf6 *"), ctx);
    expect(ok.games).toHaveLength(1);
  });
});

describe("game ids from untrusted headers", () => {
  it("uses a safe GameId as is", () => {
    expect(parsePgnText(pgn('[GameId "abc_123.x-y"]'), ctx).games[0]?.id).toBe("pgn:abc_123.x-y");
  });

  it.each([
    ["GameId", "../../etc/passwd"],
    ["GameId", "a b"],
    ["GameId", "x".repeat(65)],
    ["GameId", "<script>alert(1)</script>"],
    ["Link", "https://evil.test/game/bad%0Aid"],
  ])("falls back to a hash id for unsafe %s %s", (tag, value) => {
    const g = parsePgnText(pgn(`[${tag} "${value}"]`), ctx).games[0];
    expect(g).toBeDefined();
    expect(g!.id).toMatch(/^pgn:h[0-9a-f]{16}$/);
    expect(SAFE_ID_RE.test(g!.id)).toBe(true);
  });

  it("derives ids from Site/Link only when safe, and the hash is stable", () => {
    const a = parsePgnText(pgn('[Site "https://lichess.org/kAdOQKeh"]'), ctx).games[0];
    expect(a?.id).toBe("pgn:kAdOQKeh");
    const h1 = parsePgnText(pgn('[GameId "bad id"]'), ctx).games[0]?.id;
    const h2 = parsePgnText(pgn('[GameId "another bad id"]'), ctx).games[0]?.id;
    expect(h1).toBe(h2); // same players, date and moves
    const other = parsePgnText(pgn('[GameId "bad id"]', "1. d4 d5 *"), ctx).games[0]?.id;
    expect(other).not.toBe(h1);
  });

  it("game without any id header gets a safe hash id", () => {
    expect(parsePgnText(pgn(""), ctx).games[0]?.id).toMatch(/^pgn:h[0-9a-f]{16}$/);
  });
});
