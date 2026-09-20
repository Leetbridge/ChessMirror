import type { CoachAdvice } from "../advice";
import { aliasContext } from "../alias";
import type { CoachContext } from "../context";
import { LlmError, type LlmProvider, type LlmRequest } from "../provider";

/** Offline provider returning a canned response. Bypasses schema parsing on purpose (simulates a lax provider). */
export function fakeProvider(respond: () => unknown, name = "fake"): LlmProvider {
  return {
    name,
    async generate<T>(_request: LlmRequest<T>): Promise<T> {
      void _request;
      return respond() as T;
    },
  };
}

export function throwingProvider(): LlmProvider {
  return fakeProvider(() => {
    throw new LlmError("boom", "api");
  });
}

/** A well-behaved model answer for the shared fixtures. */
export const GOOD_ADVICE: CoachAdvice = {
  summary: "Two habits stand out across your 3 analyzed games; both are hypotheses, not certainties.",
  findings: [
    {
      findingId: "f-time",
      headline: "Blunders when the clock runs low",
      explanation:
        "In 3 positions across 2 games (lichess:AAA111 ply 31 and 35, lichess:BBB222 ply 41) you moved with 9s, 6s and 4s left. At ply 31 the engine preferred a different move than the one you played (both listed under the moves referenced). This is consistent with decisions made under time pressure.",
      whatToDo: "Do the one-move blunder-check puzzles with a 15 second limit, then set a half-time checkpoint before move 20.",
      citedRefs: [
        { gameId: "lichess:AAA111", ply: 31 },
        { gameId: "lichess:BBB222", ply: 41 },
      ],
      mentionedMoves: ["Nf3", "d1d2"],
    },
    {
      findingId: "f-tilt",
      headline: "Two opening mistakes right after a loss",
      explanation:
        "In lichess:CCC333 you made 2 mistakes (ply 12 and ply 14, listed under the moves referenced) while you still had about 120s. That may suggest your play changes after a defeat.",
      whatToDo: "Before each capture list the opponent's replies, and take the two minute reset break after a loss.",
      citedRefs: [
        { gameId: "lichess:CCC333", ply: 12 },
        { gameId: "lichess:CCC333", ply: 14 },
      ],
      mentionedMoves: ["Bxh7", "Qxb2"],
    },
  ],
};

/** Valid JSON, valid moves, but generic: must fail the grounding eval. */
export const GENERIC_ADVICE: CoachAdvice = {
  summary: "You should keep practicing.",
  findings: [
    {
      findingId: "f-time",
      headline: "Time management",
      explanation: "Time pressure can hurt anyone and this is consistent with rushed play. Take your time.",
      whatToDo: "Practice tactics daily and stay calm.",
      citedRefs: [{ gameId: "lichess:AAA111", ply: 31 }],
      mentionedMoves: [],
    },
    {
      findingId: "f-tilt",
      headline: "Losing streaks",
      explanation: "Losses can affect play, which may suggest a pattern. Think before you move.",
      whatToDo: "Keep practicing and play more slowly.",
      citedRefs: [{ gameId: "lichess:CCC333", ply: 12 }],
      mentionedMoves: [],
    },
  ],
};

/** Rewrite real game ids to the opaque aliases the prompt exposes, as a real model would answer in. */
export function inAliasSpace(advice: CoachAdvice, ctx: CoachContext): CoachAdvice {
  const aliased = aliasContext(ctx).ctx;
  const map = new Map(ctx.games.map((g, i) => [g.id, aliased.games[i]?.id ?? g.id]));
  const sub = (t: string): string => [...map].reduce((acc, [id, a]) => acc.split(id).join(a), t);
  return {
    summary: sub(advice.summary),
    findings: advice.findings.map((f) => ({
      ...f,
      headline: sub(f.headline),
      explanation: sub(f.explanation),
      whatToDo: sub(f.whatToDo),
      citedRefs: f.citedRefs.map((r) => ({ gameId: map.get(r.gameId) ?? r.gameId, ply: r.ply })),
    })),
  };
}
