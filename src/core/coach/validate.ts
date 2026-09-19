import type { CoachAdvice } from "./advice";
import { allowedMoves, detectedFindings, normalizeMove, type CoachContext } from "./context";

/** SAN-like tokens (incl. castling). Deliberately over-inclusive: a false positive only causes a template fallback. */
const SAN_RE =
  /(?<![A-Za-z0-9:_-])(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?(?![A-Za-z0-9])/g;
const UCI_RE = /(?<![A-Za-z0-9:_-])[a-h][1-8][a-h][1-8][qrbn]?(?![A-Za-z0-9])/g;

export function extractMoveTokens(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(UCI_RE)) found.add(normalizeMove(m[0]));
  // Remove UCI matches first so "e2e4" is not also read as "e2" + "e4".
  const withoutUci = text.replace(UCI_RE, " ");
  for (const m of withoutUci.matchAll(SAN_RE)) found.add(normalizeMove(m[0]));
  return [...found];
}

/** Claims about what the player felt. The tool may only offer hypotheses about patterns. */
const EMOTION_CLAIMS: RegExp[] = [
  /\byou (?:were|are|felt|feel|got|seem(?:ed)? to be)\s+(?:\w+\s+)?(?:angry|frustrated|tilted|anxious|nervous|scared|panicked|panicking|stressed|upset|afraid|impatient|overconfident|arrogant|sad|depressed|emotional|distracted|bored|lazy|careless)\b/i,
  /\byou (?:panicked|tilted|choked|gave up|lost (?:your )?(?:composure|nerve|temper|focus))\b/i,
  /\byour (?:emotions?|anxiety|anger|frustration|nerves?) (?:made|caused|led|drove)\b/i,
  /\b(?:clearly|obviously|definitely|certainly) (?:tilted|anxious|frustrated|panicked|nervous)\b/i,
];

const HEDGES =
  /\b(?:consistent with|may suggest|might suggest|could suggest|may indicate|could indicate|might indicate|possibly|one possible|a possible|hypothesis|may reflect|could reflect|might be|may be|could be|appears? to|tends? to|pattern)\b/i;

export function findEmotionClaim(text: string): string | undefined {
  for (const re of EMOTION_CLAIMS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return undefined;
}

export function hasHedge(text: string): boolean {
  return HEDGES.test(text);
}

export type ValidationResult = { ok: true } | { ok: false; reasons: string[] };

/**
 * Post-validation of LLM output against the supplied data. Any failure means the
 * caller must use the template fallback.
 */
export function validateAdvice(advice: CoachAdvice, ctx: CoachContext): ValidationResult {
  const reasons: string[] = [];
  const detected = detectedFindings(ctx);
  const findingIds = new Set(detected.map((f) => f.id));
  const allowed = allowedMoves(ctx);

  const seen = new Set<string>();
  for (const fa of advice.findings) {
    if (!findingIds.has(fa.findingId)) reasons.push(`unknown findingId ${fa.findingId}`);
    if (seen.has(fa.findingId)) reasons.push(`duplicate findingId ${fa.findingId}`);
    seen.add(fa.findingId);
  }
  for (const f of detected) {
    if (!seen.has(f.id)) reasons.push(`missing advice for finding ${f.id}`);
  }

  const evidenceByFinding = new Map(
    detected.map((f) => [f.id, new Set(f.evidence.map((e) => `${e.gameId}#${e.ply}`))]),
  );

  const texts: string[] = [advice.summary];
  for (const fa of advice.findings) {
    texts.push(fa.headline, fa.explanation, fa.whatToDo);
    const own = evidenceByFinding.get(fa.findingId);
    for (const r of fa.citedRefs) {
      if (own && !own.has(`${r.gameId}#${r.ply}`)) {
        reasons.push(`finding ${fa.findingId} cites ref not in its evidence: ${r.gameId} ply ${r.ply}`);
      }
    }
    for (const mv of fa.mentionedMoves) {
      if (!allowed.has(normalizeMove(mv))) reasons.push(`declared move not in engine data: ${mv}`);
    }
    if (!hasHedge(fa.explanation)) reasons.push(`finding ${fa.findingId} explanation lacks hypothesis wording`);
  }

  for (const t of texts) {
    for (const tok of extractMoveTokens(t)) {
      if (!allowed.has(tok)) reasons.push(`move-like token in text not in engine data: ${tok}`);
    }
    const emo = findEmotionClaim(t);
    if (emo) reasons.push(`emotion claim: "${emo}"`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
