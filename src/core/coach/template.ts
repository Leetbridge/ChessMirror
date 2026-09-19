import type { CoachAdvice, FindingAdvice } from "./advice";
import {
  detectedFindings,
  formatClock,
  type CoachContext,
  type EngineMoveRef,
} from "./context";
import type { DetectedFinding } from "../domain";

/** Detector ids are owned by habits/. Keys here are matched as substrings; unknown ids get the generic frame. */
const DETECTOR_FRAMES: { match: RegExp; headline: string; frame: string }[] = [
  { match: /time|clock/i, headline: "Mistakes when the clock is low", frame: "consistent with decisions being made under time pressure" },
  { match: /tilt/i, headline: "Play after a loss", frame: "consistent with a change in play right after a defeat" },
  { match: /win|throw|convert/i, headline: "Winning positions that slipped", frame: "consistent with difficulty converting an advantage" },
  { match: /fast|quick|critical|rush/i, headline: "Fast moves in critical positions", frame: "consistent with moving quickly when the position needed more thought" },
  { match: /resign/i, headline: "Playing on in lost games", frame: "consistent with a reluctance to end lost games" },
];

function frameFor(detector: string): { headline: string; frame: string } {
  const hit = DETECTOR_FRAMES.find((d) => d.match.test(detector));
  return hit ?? { headline: `Pattern: ${detector}`, frame: "consistent with a recurring pattern in your games" };
}

function describeMove(m: EngineMoveRef): string {
  const parts = [`game ${m.gameId}, ply ${m.ply}: you played ${m.playedSan}`];
  if (m.bestUci) parts.push(`the engine preferred ${m.bestSan ?? m.bestUci}`);
  if (m.clockMs !== undefined) parts.push(`${formatClock(m.clockMs)} left`);
  return parts.join(", ");
}

const MAX_EXAMPLES = 3;

export function templateFindingAdvice(f: DetectedFinding, ctx: CoachContext): FindingAdvice {
  const { headline, frame } = frameFor(f.detector);
  const games = new Set(f.evidence.map((e) => e.gameId));
  const examples: EngineMoveRef[] = [];
  for (const ev of f.evidence) {
    const m = ctx.moves.find((x) => x.gameId === ev.gameId && x.ply === ev.ply);
    if (m && examples.length < MAX_EXAMPLES) examples.push(m);
  }
  const shown = f.evidence.slice(0, MAX_EXAMPLES);

  const counts = `This showed up in ${f.evidence.length} position${f.evidence.length === 1 ? "" : "s"} across ${games.size} game${games.size === 1 ? "" : "s"}.`;
  const exampleText =
    examples.length > 0
      ? ` Examples: ${examples.map(describeMove).join("; ")}.`
      : ` Examples: ${shown.map((e) => `game ${e.gameId}, ply ${e.ply}`).join("; ")}.`;

  return {
    findingId: f.id,
    headline,
    explanation: `${counts} The pattern is ${frame}. ${f.explanation}${exampleText}`,
    whatToDo: `${f.chessDrill.title}: ${f.chessDrill.description} Then, off the board: ${f.softSkillDrill.title}: ${f.softSkillDrill.description}`,
    citedRefs: shown.map((e) => ({ gameId: e.gameId, ply: e.ply })),
    mentionedMoves: examples.flatMap((m) => [m.playedSan, ...(m.bestUci ? [m.bestSan ?? m.bestUci] : [])]),
  };
}

/** Deterministic, key-free advice built only from findings and engine data. */
export function templateAdvice(ctx: CoachContext): CoachAdvice {
  const detected = detectedFindings(ctx);
  const insufficient = ctx.findings.length - detected.length;
  const summary =
    detected.length === 0
      ? "No recurring pattern was detected in the analyzed games. That may simply mean there is not enough data yet."
      : `${detected.length} recurring pattern${detected.length === 1 ? "" : "s"} found across ${ctx.games.length} game${ctx.games.length === 1 ? "" : "s"}` +
        `${insufficient > 0 ? `; ${insufficient} detector${insufficient === 1 ? "" : "s"} had too little data` : ""}. ` +
        "These are hypotheses drawn from your own games, not certainties.";
  return { summary, findings: detected.map((f) => templateFindingAdvice(f, ctx)) };
}
