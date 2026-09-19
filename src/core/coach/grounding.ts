import type { CoachAdvice, FindingAdvice } from "./advice";
import { detectedFindings, formatClock, type CoachContext } from "./context";

export type GroundingKind = "game" | "ply" | "count" | "clock";

export interface FindingGrounding {
  findingId: string;
  kinds: GroundingKind[];
  /** Grounded = cites at least a game or ply reference plus one more kind of the player's own data. */
  grounded: boolean;
  genericPhrases: string[];
}

/** Stock advice that is true for anyone. Fine as a supplement, a failure when it is all there is. */
const GENERIC_PHRASES = [
  /take your time/i,
  /think before you move/i,
  /always (?:check|look for) (?:tactics|blunders)/i,
  /practice (?:tactics|puzzles) (?:daily|every day|regularly)/i,
  /stay calm/i,
  /play more slowly/i,
  /keep practicing/i,
];

function fullText(fa: FindingAdvice): string {
  return `${fa.headline} ${fa.explanation} ${fa.whatToDo}`;
}

export function checkFindingGrounding(fa: FindingAdvice, ctx: CoachContext): FindingGrounding {
  const finding = detectedFindings(ctx).find((f) => f.id === fa.findingId);
  const text = fullText(fa);
  const kinds = new Set<GroundingKind>();

  if (finding) {
    const gameIds = new Set(finding.evidence.map((e) => e.gameId));
    if ([...gameIds].some((id) => text.includes(id))) kinds.add("game");
    if (finding.evidence.some((e) => new RegExp(`\\bply\\s*${e.ply}\\b`, "i").test(text))) kinds.add("ply");
    const n = finding.evidence.length;
    if (new RegExp(`\\b${n}\\s+(?:\\w+\\s+){0,2}(?:positions?|moves?|games?|times?|moments?|blunders?|mistakes?)\\b`, "i").test(text)) {
      kinds.add("count");
    }
    const clocks = ctx.moves
      .filter((m) => gameIds.has(m.gameId) && m.clockMs !== undefined)
      .map((m) => formatClock(m.clockMs ?? 0));
    if (clocks.some((c) => new RegExp(`\\b${c}\\b`).test(text))) kinds.add("clock");
  }

  const grounded = (kinds.has("game") || kinds.has("ply")) && kinds.size >= 2;
  return {
    findingId: fa.findingId,
    kinds: [...kinds],
    grounded,
    genericPhrases: GENERIC_PHRASES.filter((re) => re.test(text)).map((re) => re.source),
  };
}

/** Eval helper: does the advice reference the player's own data rather than generic tips? */
export function checkGrounding(advice: CoachAdvice, ctx: CoachContext): { ok: boolean; findings: FindingGrounding[] } {
  const findings = advice.findings.map((fa) => checkFindingGrounding(fa, ctx));
  return { ok: findings.length > 0 && findings.every((f) => f.grounded), findings };
}
