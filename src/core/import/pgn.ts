import { createHash } from "node:crypto";
import { Chess } from "chess.js";
import { GameSchema, type Game, type GameResult, type GameSourceId, type Move, type TimeControl } from "../domain";

export interface ParseContext {
  source: GameSourceId;
  /** The user whose side is analyzed. Matched case-insensitively against White/Black. */
  username: string;
  /** Used when the PGN has no usable date (ISO 8601). */
  fallbackPlayedAt?: string;
  /** Cap on games examined by parsePgnText; never above MAX_GAMES. */
  maxGames?: number;
}

/** Hard limits for untrusted PGN input. */
export const MAX_GAMES = 1000;
export const MAX_INPUT_CHARS = 20_000_000;
/** Maximum half-moves accepted per game; longer games are skipped. */
export const MAX_PLIES_PER_GAME = 1000;
/** Game ids taken from untrusted headers must match this, otherwise a hash-based id is generated. */
export const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export class PgnLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PgnLimitError";
  }
}

export type SkipReason =
  | "variant"
  | "custom-start"
  | "no-moves"
  | "invalid-pgn"
  | "user-not-in-game"
  | "invalid-game"
  | "too-long"
  | "over-limit";

export type ParseOutcome = { ok: true; game: Game } | { ok: false; reason: SkipReason; detail?: string };

const CLK = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/;

/** "[%clk h:mm:ss(.d)]" in a PGN comment to milliseconds. Returns undefined when absent. */
export function parseClockMs(comment: string | undefined): number | undefined {
  const m = comment ? CLK.exec(comment) : null;
  if (!m) return undefined;
  const ms = Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Split multi-game PGN text into single-game strings. */
export function splitPgn(text: string): string[] {
  if (text.length > MAX_INPUT_CHARS) {
    throw new PgnLimitError(`PGN input is larger than ${MAX_INPUT_CHARS} characters.`);
  }
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n(?=\[Event\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** "180+2" -> 180s + 2s; "600" -> 600s; "-" and daily "1/86400" -> undefined. */
export function parseTimeControl(tc: string | undefined): TimeControl | undefined {
  if (!tc) return undefined;
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc.trim());
  if (!m) return undefined;
  return { initialSec: Number(m[1]), incrementSec: Number(m[2] ?? 0) };
}

function parseResult(r: string | undefined): GameResult {
  if (r === "1-0") return "white";
  if (r === "0-1") return "black";
  if (r === "1/2-1/2") return "draw";
  return "unknown";
}

function parseRating(v: string | undefined): number | undefined {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function playedAt(h: Record<string, string>, fallback: string | undefined): string {
  const date = h["UTCDate"] ?? h["Date"];
  const time = h["UTCTime"] ?? h["Time"] ?? "00:00:00";
  if (date && /^\d{4}\.\d{2}\.\d{2}$/.test(date) && /^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return `${date.replace(/\./g, "-")}T${time}Z`;
  }
  return fallback ?? "1970-01-01T00:00:00Z";
}

/** Parse ONE game's PGN. Non-standard games and unusable input are skipped, never thrown. */
export function parseGamePgn(pgn: string, ctx: ParseContext): ParseOutcome {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (e) {
    return { ok: false, reason: "invalid-pgn", detail: e instanceof Error ? e.message : String(e) };
  }
  const h = chess.getHeaders();

  const variant = (h["Variant"] ?? "Standard").toLowerCase();
  if (variant !== "standard" && variant !== "chess") {
    return { ok: false, reason: "variant", detail: h["Variant"] };
  }
  // Chess960 and set-up positions carry a FEN header; classification assumes the standard start.
  if (h["FEN"] || h["SetUp"] === "1") return { ok: false, reason: "custom-start" };

  const history = chess.history({ verbose: true });
  if (history.length === 0) return { ok: false, reason: "no-moves" };
  if (history.length > MAX_PLIES_PER_GAME) return { ok: false, reason: "too-long", detail: `${history.length} plies` };

  const white = h["White"]?.trim() ?? "";
  const black = h["Black"]?.trim() ?? "";
  const me = ctx.username.trim().toLowerCase();
  const userColor = white.toLowerCase() === me ? "white" : black.toLowerCase() === me ? "black" : undefined;
  if (!userColor) return { ok: false, reason: "user-not-in-game" };

  // getComments() returns one entry per position that has a comment, keyed by the FEN after the move.
  const commentByFen = new Map(chess.getComments().map((c) => [c.fen, c.comment]));
  const moves: Move[] = history.map((mv, i) => {
    const clockMs = parseClockMs(commentByFen.get(mv.after));
    return {
      ply: i + 1,
      san: mv.san,
      uci: `${mv.from}${mv.to}${mv.promotion ?? ""}`,
      ...(clockMs !== undefined ? { clockMs } : {}),
    };
  });

  const site = h["Site"] ?? "";
  const link = h["Link"] ?? (/^https?:\/\//.test(site) ? site : undefined);
  const rawId = h["GameId"] ?? (link ? link.split("/").filter(Boolean).pop() : undefined);
  const when = playedAt(h, ctx.fallbackPlayedAt);
  // Ids from untrusted headers are used only if they are short and made of safe characters.
  const idBase =
    rawId && SAFE_ID_RE.test(rawId)
      ? rawId
      : `h${createHash("sha256")
          .update([white, black, when, ...moves.map((m) => m.uci)].join("|"))
          .digest("hex")
          .slice(0, 16)}`;
  const tc = parseTimeControl(h["TimeControl"]);
  const wr = parseRating(h["WhiteElo"]);
  const br = parseRating(h["BlackElo"]);

  const candidate = {
    id: `${ctx.source}:${idBase}`,
    source: ctx.source,
    ...(link && /^https?:\/\//.test(link) ? { url: link } : {}),
    playedAt: when,
    white: { name: white, ...(wr ? { rating: wr } : {}) },
    black: { name: black, ...(br ? { rating: br } : {}) },
    userColor,
    result: parseResult(h["Result"]),
    ...(h["Termination"] ? { termination: h["Termination"] } : {}),
    ...(tc ? { timeControl: tc } : {}),
    moves,
    pgn,
  };
  const parsed = GameSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "invalid-game", detail: parsed.error.message };
  return { ok: true, game: parsed.data };
}

/** Parse multi-game PGN text; skipped games are reported, not thrown. */
export function parsePgnText(
  text: string,
  ctx: ParseContext,
): { games: Game[]; skipped: { reason: SkipReason; detail?: string }[] } {
  const games: Game[] = [];
  const skipped: { reason: SkipReason; detail?: string }[] = [];
  const limit = Math.min(ctx.maxGames ?? MAX_GAMES, MAX_GAMES);
  for (const chunk of splitPgn(text)) {
    if (games.length + skipped.length >= limit) {
      skipped.push({ reason: "over-limit", detail: `stopped after ${limit} games` });
      break;
    }
    const r = parseGamePgn(chunk, ctx);
    if (r.ok) games.push(r.game);
    else skipped.push({ reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
  }
  return { games, skipped };
}
