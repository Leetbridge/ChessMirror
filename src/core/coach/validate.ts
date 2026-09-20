import type { CoachAdvice } from "./advice";
import { allowedMoves, detectedFindings, normalizeMove, type CoachContext } from "./context";

/**
 * SAN/UCI-like tokens. Deliberately over-inclusive, but ASCII and case-sensitive, so it is NOT a security
 * boundary: it can be evaded (see tests/grounding.test.ts history). It is kept for the trusted template path
 * and for tests. The decision path for LLM text is `containsMoveLikeContent` below.
 */
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

// ---------------------------------------------------------------------------------------------
// Strict rule for LLM free text: NO chess-move content at all.
//
// The LLM may name moves only through `mentionedMoves`, which is matched exactly against engine data.
// Everything else is scanned by `moveLikeReasons` on NORMALISED text. This is deliberately over-inclusive:
// a false positive (for example "B2B", or "a 3 game streak") only makes us fall back to the template,
// which is safe. A false negative is the failure we must avoid.
//
// RESIDUAL RISK (cannot be closed by any regex): pure prose that names a move without any square or
// notation ("take the queen with the knight on the left", "push the pawn in front of the king") can be
// paraphrased in unboundedly many ways. The prompt forbids it and the rules below catch the common
// phrasings, but it can never be excluded. Also unhandled: visual digit look-alikes (l or I for 1),
// spelled-out squares in other languages. See docs/KNOWN-LIMITATIONS.md.
// ---------------------------------------------------------------------------------------------

/** Chars that render as nothing but can split a token: format (Cf, includes ZWSP/soft hyphen/BOM/word joiner), controls, Hangul/Mongolian fillers, braille blank. */
const INVISIBLE = /[\p{Cf}\p{Cc}\u115F\u1160\u3164\uFFA0\u180E\u2800\u17B4\u17B5]/gu;
const DASHES = /[\p{Pd}\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]/gu;

/** Common Cyrillic / Greek / Latin-extension look-alikes of a-z (input is already lower-cased). */
const LOOKALIKES: Readonly<Record<string, string>> = {
  "\u0430": "a", "\u0432": "b", "\u0441": "c", "\u0501": "d", "\u0435": "e", "\u0455": "s", "\u0456": "i",
  "\u0458": "j", "\u043A": "k", "\u043C": "m", "\u043D": "h", "\u043E": "o", "\u0440": "p", "\u0442": "t",
  "\u0445": "x", "\u0443": "y", "\u0475": "v", "\u0261": "g", "\u0192": "f",
  "\u03BF": "o", "\u03B1": "a", "\u03B5": "e", "\u03B2": "b", "\u03BA": "k", "\u03BD": "v", "\u03C1": "p",
  "\u03C4": "t", "\u03C5": "u", "\u03B9": "i", "\u03C7": "x", "\u03B7": "n", "\u03F2": "c", "\u03F3": "j",
};

/** NFKD, lower-case, invisible and combining marks removed, look-alikes folded to ASCII, dash-likes mapped to "-". */
export function normalizeForMoveScan(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(INVISIBLE, "")
    .replace(/\p{M}/gu, "")
    .replace(/\P{ASCII}/gu, (c) => LOOKALIKES[c] ?? c)
    .replace(DASHES, "-")
    .normalize("NFKC");
}

const PIECES =
  "knights?|bishops?|rooks?|queens?|kings?|pawns?|" + // English
  "springer|laeufer|laufer|turm|dame|koenig|konig|bauer|" + // German
  "cavalier|fou|tour|roi|pion|" + // French
  "caballo|alfil|torre|dama|reina|rey|peon|" + // Spanish
  "kon|slon|ladya|ferz|korol|peshka"; // Russian, transliterated
const VERBS_AFTER_PIECE =
  "to|takes?|captures?|on|at|goes|go|moves?|" +
  "captured|taken|sacrificed|pushed|advanced|moved|played|traded|exchanged|hung|" +
  "nach|auf|zieht|schlaegt|schlagt|nimmt|vers|sur|prend|va|joue|en|toma|captura|mueve|juega|na|beryot|hodit";
const VERBS_BEFORE_PIECE =
  "captur(?:e|es|ed|ing)|push(?:es|ed|ing)?|advanc(?:e|es|ed|ing)|sacrific(?:e|es|ed|ing)|sac(?:s|ked)?|take|takes|took|taken|" +
  "trad(?:e|es|ed|ing)|exchang(?:e|es|ed|ing)|play(?:s|ed|ing)?|mov(?:e|es|ed|ing)|castl(?:e|es|ed|ing)|grab(?:s|bed)?|gives? up|gave up";
const MOVE_VERBS =
  "push(?:es|ed)?|advanc(?:e|es|ed)|mov(?:e|es|ed)|play(?:s|ed)?|captur(?:e|es|ed)|takes?|storm(?:s|ed)?|march(?:es|ed)?|goes|go|to";

const W = "(?:[^a-z]+[a-z]+)";
const RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["square", /[a-h][1-8](?!\d)/],
  ["uci", /[a-h][1-8][a-h][1-8]/],
  ["piece letter + file + spaced rank", /\b[kqrbn][a-h]\s+[1-8]/],
  ["spelled-out square", /(?<![a-z])[b-h][\s-]*(?:one|two|three|four|five|six|seven|eight)\b/],
  ["castling notation", /\b[o0](?:\s*-\s*[o0]){1,2}\b/],
  ["castling word", /\b(?:castl\w*|rochade|roque|enroque|rokirovka)\b/],
  ["numbered move sequence", /\d+\.\s*\.?\.?\s*[a-hnbrqko]/],
  ["piece + movement verb", new RegExp(`\\b(?:${PIECES})\\b${W}{0,3}?[^a-z]+(?:${VERBS_AFTER_PIECE})\\b`)],
  ["capture/push verb + piece", new RegExp(`\\b(?:${VERBS_BEFORE_PIECE})\\b${W}{0,5}?[^a-z]+(?:${PIECES})\\b`)],
];
const FILE_PAWN = /\b[a-h]-(?:file\s+)?pawns?\b|\b[a-h]\s+file\s+pawns?\b/;
const MOVE_VERB_RE = new RegExp(`\\b(?:${MOVE_VERBS})\\b`);

/** Which strict rules fire on this text. Empty means no chess-move content was found. */
export function moveLikeReasons(text: string): string[] {
  const n = normalizeForMoveScan(text);
  const reasons: string[] = [];
  // "f 3", "N f 3", "e-4" -> "f3", "n f3", "e4". Single a-h letters only, so "made 3 mistakes" is untouched.
  const collapsed = n.replace(/(?<![a-z])([a-h])[\s._-]+(?=[1-8](?!\d))/g, "$1");
  for (const [name, re] of RULES) if (re.test(collapsed)) reasons.push(name);
  if (FILE_PAWN.test(n) && MOVE_VERB_RE.test(n)) reasons.push("file-pawn phrase + movement verb");
  // After folding, any letter outside a-z and Latin-1/Latin Extended-A is an unverifiable look-alike (small caps,
  // Cyrillic, Greek, ...). Non-ASCII decimal digits likewise. The coach writes English only, so this costs nothing.
  if (/[^\P{L}a-zß-ſ]/u.test(n) || /(?![0-9])\p{Nd}/u.test(n)) {
    reasons.push("non-Latin residue (possible look-alike)");
  }
  return reasons;
}

/** True when the text contains, or might contain, a chess move. Callers must treat true as "reject". */
export function containsMoveLikeContent(text: string): boolean {
  return moveLikeReasons(text).length > 0;
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

export interface ValidateOptions {
  /**
   * "llm" (default): untrusted model output. Moves may appear ONLY in `mentionedMoves`; free text must contain
   * no move-like content at all.
   * "template": text generated by our own code from engine data. It may show engine moves inline, so free text
   * is checked only by the engine-membership oracle (every move token must be engine data).
   */
  mode?: "llm" | "template";
}

/** Fields that are identifiers or the structured move list, checked elsewhere; every other string is free text. */
const NON_FREE_TEXT_KEYS = new Set(["findingId", "gameId", "mentionedMoves"]);

/** Fail-closed: any string in the advice that is not a known structured field counts as free text. */
function freeTextStrings(value: unknown, key = ""): string[] {
  if (NON_FREE_TEXT_KEYS.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => freeTextStrings(v, key));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => freeTextStrings(v, k));
  }
  return [];
}

/**
 * Post-validation of LLM output against the supplied data. Any failure means the
 * caller must use the template fallback.
 */
export function validateAdvice(advice: CoachAdvice, ctx: CoachContext, opts: ValidateOptions = {}): ValidationResult {
  const mode = opts.mode ?? "llm";
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

  for (const fa of advice.findings) {
    const own = evidenceByFinding.get(fa.findingId);
    for (const r of fa.citedRefs) {
      if (own && !own.has(`${r.gameId}#${r.ply}`)) {
        reasons.push(`finding ${fa.findingId} cites ref not in its evidence: ${r.gameId} ply ${r.ply}`);
      }
    }
    // The only sanctioned channel for moves: exact match (after NFKC and trimming !?+#) against engine data.
    for (const mv of fa.mentionedMoves) {
      if (!allowed.has(normalizeMove(mv))) reasons.push(`declared move not in engine data: ${JSON.stringify(mv)}`);
    }
    if (!hasHedge(fa.explanation)) reasons.push(`finding ${fa.findingId} explanation lacks hypothesis wording`);
  }

  for (const t of freeTextStrings(advice)) {
    if (mode === "llm") {
      const why = moveLikeReasons(t);
      if (why.length > 0) reasons.push(`move-like content in free text (${why.join(", ")})`);
    } else {
      for (const tok of extractMoveTokens(t)) {
        if (!allowed.has(tok)) reasons.push(`move-like token in text not in engine data: ${tok}`);
      }
    }
    const emo = findEmotionClaim(t);
    if (emo) reasons.push(`emotion claim: "${emo}"`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
