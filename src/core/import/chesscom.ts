import { z } from "zod";
import type { Game } from "../domain";
import type { GameQuery, GameSource } from "./index";
import { getWithBackoff, type HttpOptions } from "./http";
import { parsePgnText } from "./pgn";

export interface ChessComOptions extends HttpOptions {
  baseUrl?: string;
  /** Descriptive User-Agent with contact info (env CHESSCOM_USER_AGENT), as the PubAPI guidance asks. */
  userAgent: string;
}

const ArchivesSchema = z.object({ archives: z.array(z.string()) });
const MonthSchema = z.object({
  games: z.array(
    z.object({
      url: z.string().optional(),
      pgn: z.string().optional(),
      end_time: z.number().optional(),
      rules: z.string().optional(),
    }),
  ),
});

/**
 * chess.com PubAPI: GET /pub/player/{user}/games/archives -> {archives: [monthly urls]},
 * then GET each monthly url -> {games: [{pgn, rules, end_time, ...}]}.
 * Requests are strictly sequential (the docs say serial requests do not get rate limited).
 */
export class ChessComSource implements GameSource {
  readonly id = "chesscom" as const;
  constructor(private readonly opts: ChessComOptions) {
    if (!opts.userAgent.trim()) throw new Error("ChessComSource needs a descriptive User-Agent (CHESSCOM_USER_AGENT).");
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await getWithBackoff(url, { "User-Agent": this.opts.userAgent, Accept: "application/json" }, this.opts);
    return res.json();
  }

  async fetchGames(query: GameQuery): Promise<Game[]> {
    const base = this.opts.baseUrl ?? "https://api.chess.com";
    const user = encodeURIComponent(query.username.toLowerCase());
    const { archives } = ArchivesSchema.parse(await this.getJson(`${base}/pub/player/${user}/games/archives`));
    const sinceMs = query.since ? Date.parse(query.since) : undefined;
    if (query.since && Number.isNaN(sinceMs)) throw new Error(`Invalid "since" date: ${query.since}`);

    const out: Game[] = [];
    // Newest month first so `max` keeps the most recent games.
    for (const archiveUrl of [...archives].reverse()) {
      const ym = /\/(\d{4})\/(\d{2})$/.exec(archiveUrl);
      // Month ends (first instant of next month) at or before `since`: nothing older can match.
      if (ym && sinceMs !== undefined && Date.UTC(Number(ym[1]), Number(ym[2])) <= sinceMs) break;
      const month = MonthSchema.parse(await this.getJson(archiveUrl));
      const monthGames: Game[] = [];
      for (const g of month.games) {
        if (!g.pgn || (g.rules && g.rules !== "chess")) continue; // variants (chess960, bughouse, ...)
        const fallback = g.end_time ? new Date(g.end_time * 1000).toISOString().replace(".000Z", "Z") : undefined;
        monthGames.push(
          ...parsePgnText(g.pgn, {
            source: "chesscom",
            username: query.username,
            ...(fallback ? { fallbackPlayedAt: fallback } : {}),
          }).games,
        );
      }
      monthGames.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
      out.push(...monthGames.filter((g) => sinceMs === undefined || Date.parse(g.playedAt) >= sinceMs));
      if (query.max !== undefined && out.length >= query.max) break;
    }
    return query.max !== undefined ? out.slice(0, query.max) : out;
  }
}
