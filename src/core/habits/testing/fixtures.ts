import { AnalyzedGameSchema, type AnalyzedGame, type AnalyzedMove, type Color, type GameResult, type MoveClass } from "../../domain";

/** One user move. `winPct` is the user's win% AFTER the move; `before` defaults to the previous move's `winPct`. */
export interface UserMoveSpec {
  winPct: number;
  before?: number;
  cls?: MoveClass;
  /** User's clock after the move, in ms. */
  clockMs?: number;
  /** Alternative to clockMs: time spent on this move; the clock is derived from the previous one (plus increment). */
  spentMs?: number;
}

export interface GameSpec {
  id: string;
  userColor?: Color;
  result: GameResult;
  playedAt?: string;
  /** Omit for "no time control metadata". */
  timeControl?: { initialSec: number; incrementSec: number } | null;
  moves: UserMoveSpec[];
  /** Opponent clock after each opponent move, ms. Default 200000. */
  opponentClockMs?: number;
}

/**
 * Hand-built AnalyzedGame. Moves are placeholder SAN/UCI (a1a2) and evals are
 * evalCp 0: detectors read only ply, winPct, class and clockMs.
 * Opponent moves are interleaved automatically and are neutral ("good").
 * Result is validated against the domain zod schema.
 */
export function buildGame(spec: GameSpec): AnalyzedGame {
  const color: Color = spec.userColor ?? "white";
  const moves: AnalyzedMove[] = [];
  let ply = 1;
  const push = (m: Omit<AnalyzedMove, "ply" | "san" | "uci" | "evalCp">) => {
    moves.push({ ply: ply++, san: "Nf3", uci: "a1a2", evalCp: 0, ...m });
  };
  const opp = (userWinBefore: number) =>
    push({
      winPct: 100 - userWinBefore,
      class: "good",
      clockMs: spec.opponentClockMs ?? 200_000,
    });

  let prev = 50;
  let clock = (spec.timeControl?.initialSec ?? 600) * 1000;
  const inc = (spec.timeControl?.incrementSec ?? 0) * 1000;
  if (color === "black") opp(prev);
  spec.moves.forEach((u, i) => {
    const before = u.before ?? prev;
    if (u.clockMs !== undefined) clock = u.clockMs;
    else if (u.spentMs !== undefined) clock = clock - u.spentMs + inc;
    const hasClock = u.clockMs !== undefined || u.spentMs !== undefined;
    // Opponent's reply is emitted after the user's move, except for the game's last move.
    push({
      winPct: u.winPct,
      winPctBefore: before,
      class: u.cls ?? "good",
      ...(hasClock ? { clockMs: clock } : {}),
    });
    prev = u.winPct;
    const next = spec.moves[i + 1];
    if (next) {
      // opponent move leads to the next user move's "before"
      const nextBefore = next.before ?? prev;
      opp(nextBefore);
      prev = nextBefore;
    }
  });

  return AnalyzedGameSchema.parse({
    game: {
      id: spec.id,
      source: "pgn",
      playedAt: spec.playedAt ?? "2026-01-01T12:00:00.000Z",
      white: { name: color === "white" ? "user" : "opp" },
      black: { name: color === "black" ? "user" : "opp" },
      userColor: color,
      result: spec.result,
      ...(spec.timeControl === null
        ? {}
        : { timeControl: spec.timeControl ?? { initialSec: 600, incrementSec: 0 } }),
    },
    moves,
    engine: { name: "fixture", depth: 20 },
    analyzedAt: "2026-01-02T00:00:00.000Z",
  });
}

/** `n` calm, clean moves (win% steady at `level`), 10s per move, so ample clock in a 10+0 game. */
export function calmMoves(n: number, level = 50): UserMoveSpec[] {
  return Array.from({ length: n }, () => ({ winPct: level, before: level, cls: "good" as MoveClass, spentMs: 10_000 }));
}

/** ISO timestamp `minutes` after `startIso`. */
export function isoAt(startIso: string, minutes: number): string {
  return new Date(Date.parse(startIso) + minutes * 60_000).toISOString();
}
