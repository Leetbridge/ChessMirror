import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Loader for the synthetic PGN fixtures. Other agents' tests can import this:
 *
 *   import { loadManifest, readFixture, splitGames } from "../fixtures/load";
 *
 * It depends only on node and zod, never on src/.
 */

export const FIXTURES_DIR = __dirname;

const clocksSchema = z.enum(["all", "none", "partial"]);

const materialLeadSchema = z.object({
  hero: z.enum(["w", "b"]),
  peak: z.number().int(),
  peakPly: z.number().int().optional(),
  final: z.number().int(),
});

export const gameExpectationSchema = z.object({
  result: z.enum(["1-0", "0-1", "1/2-1/2", "*"]),
  /** null when chess.js cannot parse the game. */
  plies: z.number().int().nonnegative().nullable(),
  clocks: clocksSchema,
  clockedPlies: z.number().int().nonnegative(),
  variant: z.string().nullable(),
  chessJsParses: z.boolean(),
  endsInCheckmate: z.boolean(),
  termination: z.string().nullable(),
  timeControl: z.string().nullable(),
  clockHasTenths: z.boolean().optional(),
  hasEvalComments: z.boolean().optional(),
  hero: z.enum(["w", "b"]).optional(),
  heroClockUnder10FromPly: z.number().int().optional(),
  heroMinClockSec: z.number().optional(),
  heroBlunderPly: z.number().int().optional(),
  heroDeficitAtLeast5FromPly: z.number().int().optional(),
  heroMovesAfterLost: z.number().int().optional(),
  materialLead: materialLeadSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const manifestSchema = z.object({
  version: z.literal(1),
  files: z.array(
    z.object({
      file: z.string(),
      purpose: z.string(),
      games: z.array(gameExpectationSchema).min(1),
    }),
  ),
});

export type GameExpectation = z.infer<typeof gameExpectationSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

export function loadManifest(): Manifest {
  const raw: unknown = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "manifest.json"), "utf8"));
  return manifestSchema.parse(raw);
}

/** Read a fixture by its manifest path, e.g. "pgn/short_fools_mate.pgn". */
export function readFixture(file: string): string {
  return readFileSync(path.join(FIXTURES_DIR, file), "utf8");
}

/**
 * Split a multi-game PGN into single-game texts. A new game starts at a tag
 * line that follows movetext (including a bare result token such as "*").
 */
export function splitGames(pgn: string): string[] {
  const games: string[] = [];
  let current: string[] = [];
  let sawMovetext = false;
  for (const line of pgn.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && sawMovetext) {
      games.push(current.join("\n").trim());
      current = [];
      sawMovetext = false;
    }
    if (trimmed !== "" && !trimmed.startsWith("[")) sawMovetext = true;
    current.push(line);
  }
  const last = current.join("\n").trim();
  if (last !== "") games.push(last);
  return games;
}

/** Raw tag pairs, read without chess.js so unparseable games can still be inspected. */
export function rawHeaders(gamePgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of gamePgn.split(/\r?\n/)) {
    const m = /^\[(\w+) "(.*)"\]\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) headers[m[1]] = m[2];
  }
  return headers;
}

const CLK = /\[%clk (\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/;

/** Seconds from a comment containing [%clk H:MM:SS(.d)], or null. */
export function parseClkSeconds(comment: string): number | null {
  const m = CLK.exec(comment);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
