import type { Game } from "../domain";
import type { GameQuery, GameSource } from "./index";
import { getWithBackoff, type HttpOptions } from "./http";
import { parsePgnText } from "./pgn";

export interface LichessOptions extends HttpOptions {
  baseUrl?: string;
  userAgent?: string;
}

// Standard-rules perf types from GET /api/games/user (PerfType enum in the Lichess API spec).
// Excluding variant perfs server-side saves bandwidth; the parser still skips non-standard games.
const STANDARD_PERFS = "ultraBullet,bullet,blitz,rapid,classical,correspondence";

/**
 * Lichess games export: GET /api/games/user/{username}, Accept application/x-chess-pgn.
 * Query params used (verified in the Lichess API spec): since (ms epoch), max, perfType,
 * clocks (adds [%clk] comments), opening, evals. One request per call, 429 handled by getWithBackoff.
 */
export class LichessSource implements GameSource {
  readonly id = "lichess" as const;
  constructor(private readonly opts: LichessOptions = {}) {}

  async fetchGames(query: GameQuery): Promise<Game[]> {
    const params = new URLSearchParams({ clocks: "true", opening: "false", evals: "false", perfType: STANDARD_PERFS });
    if (query.max !== undefined) params.set("max", String(query.max));
    if (query.since) {
      const ms = Date.parse(query.since);
      if (Number.isNaN(ms)) throw new Error(`Invalid "since" date: ${query.since}`);
      params.set("since", String(ms));
    }
    const base = this.opts.baseUrl ?? "https://lichess.org";
    const url = `${base}/api/games/user/${encodeURIComponent(query.username)}?${params}`;
    const res = await getWithBackoff(
      url,
      {
        Accept: "application/x-chess-pgn",
        "User-Agent": this.opts.userAgent ?? "chessmirror (open-source chess coach)",
      },
      this.opts,
    );
    const text = await res.text();
    return parsePgnText(text, { source: "lichess", username: query.username }).games;
  }
}
