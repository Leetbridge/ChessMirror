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
// a false positive (for example "B2B", "a 3 game streak", or any mention of a queen) only makes us fall back to the template,
// which is safe. A false negative is the failure we must avoid.
//
// Piece words are rejected outright (no verb needed), which removes most prose paraphrases.
// RESIDUAL RISK (cannot be closed by any regex): pure prose that names no piece and no square
// ("retreat one step", "go back to the start") can be paraphrased in unboundedly many ways. The prompt forbids
// it, but it can never be excluded. Also unhandled: visual digit look-alikes (l or I for 1). See
// docs/KNOWN-LIMITATIONS.md.
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

/**
 * Piece words in any supported language. ANY occurrence in LLM free text is rejected (no verb needed): prose
 * paraphrases such as "the bishop retreats" cannot be closed by verb lists, so the stronger rule is to keep pieces
 * out of the text altogether. Plural and possessive forms are covered by the optional suffix. Lists come from
 * general chess terminology and were not reviewed by native speakers.
 */
const PIECE_STEMS =
  "knight|bishop|rook|queen|king|pawn|queenside|kingside|" + // English
  "springer|laeufer|laufer|turm|dame|koenig|konig|bauer|" + // German
  "cavalier|fou|tour|reine|roi|pion|" + // French
  "caballo|alfil|torre|dama|reina|rey|peon|" + // Spanish
  "kon|slon|ladya|ladia|ferz|korol|koroleva|peshka"; // Russian, transliterated
const PIECE_WORD = new RegExp(`\\b(?:${PIECE_STEMS})(?:s|es)?\\b`);

/** Digit words, ordinals and the Spanish/French/German/Russian-transliterated digit words used to spell out a rank. */
const NUM_WORDS =
  "one|two|three|four|five|six|seven|eight|first|second|third|fourth|fifth|sixth|seventh|eighth|" +
  "uno|dos|tres|cuatro|cinco|seis|siete|ocho|un|deux|trois|quatre|cinq|sept|huit|" +
  "eins|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|odin|dva|tri|chetyre|pyat|shest|sem|vosem";
const SEP = "[\\s\\p{P}\\p{S}]+";
const A_SPELLED = new RegExp(`(?<![a-z])a${SEP}(?:${NUM_WORDS})\\b`, "gu");
const A_SPELLED_WITH_VERB = new RegExp(
  `(?<![a-z])a${SEP}(?:${NUM_WORDS})\\b(?:[^a-z]+[a-z]+){0,4}?[^a-z]+(?:to|takes|on|at|goes|moves|nach|auf)\\b`,
  "u",
);

const RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["square", /[a-h][1-8](?!\d)/],
  ["uci", /[a-h][1-8][a-h][1-8]/],
  // b-h only here; the a-file needs context (see A_SPELLED). A separator is required so "done" or "gone" pass.
  ["spelled-out square", new RegExp(`(?<![a-z])[b-h]${SEP}(?:${NUM_WORDS})\\b`, "u")],
  ["roman-numeral square", new RegExp(`(?<![a-z])[b-h]${SEP}(?:iv|vi{0,3}|i{1,3}|ix)\\b`, "u")],
  ["castling notation", /\b[o0](?:\s*-\s*[o0]){1,2}\b/],
  ["castling word", /\b(?:castl\w*|rochade|roque|enroque|rokirovka)\b/],
  ["promotion / en passant / named mate", /\b(?:under)?promot\w*|\ben passant\b|\bdiscovered check\b|\bmate in (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/],
  ["numbered move sequence", /\d+\.\s*\.?\.?\s*[a-hnbrqko]/],
  ["figurine chess glyph", /[♔-♟\u{1FA00}-\u{1FA6F}]/u],
  ["piece word", PIECE_WORD],
];

/** Which strict rules fire on this text. Empty means no chess-move content was found. */
export function moveLikeReasons(text: string): string[] {
  const n = normalizeForMoveScan(text);
  const reasons: string[] = [];
  // Join a file letter (optionally after a piece letter) and a rank across whitespace and ANY punctuation or
  // symbol: "f 3", "e-4", "e/4", "e(4)", "N e * 4" become "f3", "e4", ... The letter must not be part of a word,
  // so "made 3 mistakes" is untouched.
  const collapsed = n.replace(new RegExp(`(?<![a-z])([kqrbn]?[a-h])${SEP}(?=[1-8](?!\\d))`, "gu"), "$1");
  for (const [name, re] of RULES) if (re.test(collapsed)) reasons.push(name);
  // "a" is also the English article ("a three-game streak"), so the a-file only counts with a movement word
  // nearby, or when the text spells out more than one square.
  if (A_SPELLED_WITH_VERB.test(n) || (n.match(A_SPELLED)?.length ?? 0) >= 2) reasons.push("spelled-out a-file square");
  // After folding, any letter outside plain a-z is unverifiable (small caps, stroked letters, Cyrillic, Greek, ...).
  // Non-ASCII decimal digits likewise. The coach writes English only, so this costs nothing.
  if (/[^\P{L}a-z]/u.test(n) || /(?![0-9])\p{Nd}/u.test(n)) reasons.push("non-ASCII letter or digit (possible look-alike)");
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
    const emo = findEmotionClaim(t) ?? findEmotionClaim(normalizeForMoveScan(t));
    if (emo) reasons.push(`emotion claim: "${emo}"`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Most moves shown per finding. Keeps the stored result small whatever the model sends. */
export const MAX_REFERENCED_MOVES = 8;

/**
 * Moves to display per finding: normalised (NFKC, trimmed, no !?+# glyphs), deduplicated, members of the engine
 * data only, capped. Never returns the model's raw string, so the display cannot carry anything but engine moves.
 */
export function referencedMovesByFinding(advice: CoachAdvice, ctx: CoachContext): Record<string, string[]> {
  const allowed = allowedMoves(ctx);
  const out: Record<string, string[]> = {};
  for (const fa of advice.findings) {
    const shown = new Set<string>();
    for (const raw of fa.mentionedMoves) {
      const m = normalizeMove(raw);
      if (allowed.has(m) && shown.size < MAX_REFERENCED_MOVES) shown.add(m);
    }
    if (shown.size > 0) out[fa.findingId] = [...shown];
  }
  return out;
}
