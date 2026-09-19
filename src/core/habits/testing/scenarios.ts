import type { AnalyzedGame } from "../../domain";
import { buildGame, calmMoves, isoAt, type UserMoveSpec } from "./fixtures";

const T0 = "2026-03-01T10:00:00.000Z";
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const id = (prefix: string, i: number) => `${prefix}:${i}`;

/** 6 games: 25 calm moves then 6 moves under 60s left; games 0-4 blunder on the 3rd time-trouble move (ply 55). */
export function timeTroublePositive(): AnalyzedGame[] {
  return range(6).map((i) => {
    const tt: UserMoveSpec[] = range(6).map((j) => ({
      winPct: 50,
      before: 50,
      cls: i < 5 && j === 2 ? "blunder" : "good",
      clockMs: 40_000 - j * 5_000,
    }));
    return buildGame({ id: id("tt", i), result: "black", moves: [...calmMoves(25), ...tt] });
  });
}

/** Same shape, but the blunders happen early with plenty of time and time trouble is clean. */
export function timeTroubleNegative(): AnalyzedGame[] {
  return range(6).map((i) => {
    const early = calmMoves(25);
    if (i < 5) early[5] = { winPct: 20, before: 50, cls: "blunder", spentMs: 10_000 };
    const tt: UserMoveSpec[] = range(6).map((j) => ({ winPct: 50, before: 50, cls: "good", clockMs: 40_000 - j * 5_000 }));
    return buildGame({ id: id("tt", i), result: "white", moves: [...early, ...tt] });
  });
}

/** Games with a time control but no clock values on any move. */
export function noClockGames(n = 8): AnalyzedGame[] {
  return range(n).map((i) =>
    buildGame({
      id: id("noclock", i),
      result: "black",
      moves: range(30).map(() => ({ winPct: 50, before: 50, cls: "good" as const })),
    }),
  );
}

interface TiltOpts {
  postBlunders: number;
  baselineBlunders: number;
}

function withBlunders(n: number, blunders: number) {
  const m = calmMoves(n);
  for (let k = 0; k < blunders; k++) m[3 + k * 4] = { winPct: 20, before: 50, cls: "blunder", spentMs: 10_000 };
  return m;
}

/**
 * 12 games: 3 sessions of (loss, then a game 20 minutes later) plus 6 standalone games spaced 3h apart.
 * Post-loss games are 30 moves each with `postBlunders` blunders; the other 9 games have `baselineBlunders` in total (on the standalone games).
 */
export function tiltScenario({ postBlunders, baselineBlunders }: TiltOpts): AnalyzedGame[] {
  const games: AnalyzedGame[] = [];
  range(3).forEach((s) => {
    const start = isoAt(T0, s * 24 * 60);
    games.push(buildGame({ id: id("loss", s), result: "black", playedAt: start, moves: calmMoves(30) }));
    games.push(
      buildGame({ id: id("post", s), result: "white", playedAt: isoAt(start, 20), moves: withBlunders(30, postBlunders) }),
    );
  });
  range(6).forEach((s) => {
    games.push(
      buildGame({
        id: id("base", s),
        result: "white",
        playedAt: isoAt(T0, 5 * 24 * 60 + s * 180),
        moves: withBlunders(30, s < baselineBlunders ? 1 : 0),
      }),
    );
  });
  return games;
}

/** Winning-position games. Each `thrown` game reaches 85%, then collapses (evidence at ply 5). */
export function thrownScenario(thrown: number, converted: number, neverWinning = 1): AnalyzedGame[] {
  const collapse: UserMoveSpec[] = [
    { winPct: 85 },
    { winPct: 88 },
    { winPct: 40, before: 88, cls: "blunder" },
    { winPct: 10, cls: "blunder" },
  ];
  const convert: UserMoveSpec[] = [{ winPct: 85 }, { winPct: 92 }, { winPct: 99 }];
  return [
    ...range(thrown).map((i) => buildGame({ id: id("thrown", i), result: i % 2 ? "draw" : "black", moves: collapse })),
    ...range(converted).map((i) => buildGame({ id: id("conv", i), result: "white", moves: convert })),
    ...range(neverWinning).map((i) => buildGame({ id: id("flat", i), result: "draw", moves: calmMoves(20) })),
  ];
}

/** 6 games: 20 calm moves then 2 errors. Spent time per error is configurable; `before` is the win% before the error. */
export function fastScenario(errorSpentMs: number, errorBefore = 50): AnalyzedGame[] {
  return range(6).map((i) =>
    buildGame({
      id: id("fast", i),
      result: "black",
      moves: [
        ...calmMoves(20),
        { winPct: errorBefore - 25, before: errorBefore, cls: "blunder", spentMs: errorSpentMs },
        { winPct: errorBefore - 30, before: errorBefore, cls: "mistake", spentMs: errorSpentMs },
      ],
    }),
  );
}

/** 6 lost games: 10 calm moves then `hopelessMoves` hopeless ones (first hopeless move is ply 21). */
export function lostScenario(hopelessMoves: number, count = 6): AnalyzedGame[] {
  return range(count).map((i) =>
    buildGame({
      id: id("lost", i),
      result: "black",
      moves: [
        ...calmMoves(10),
        ...range(hopelessMoves).map((): UserMoveSpec => ({ winPct: 2, cls: "blunder" })),
      ],
    }),
  );
}
