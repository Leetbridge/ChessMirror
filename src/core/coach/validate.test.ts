import { describe, expect, it } from "vitest";
import { COACH_SYSTEM_PROMPT } from "./prompts";
import { MAX_REFERENCED_MOVES, containsMoveLikeContent, moveLikeReasons, normalizeForMoveScan, referencedMovesByFinding, validateAdvice } from "./validate";
import { GOOD_ADVICE } from "./evals/fake-provider";
import { ctx } from "./evals/fixtures";
import type { CoachAdvice } from "./advice";

/** Every entry must be flagged. Grouped by the rule it is meant to exercise. */
const MUST_FLAG: Record<string, string[]> = {
  "square anywhere, no word boundary": ["qxf7+", "nf3", "QXF7", "playNf5", "Ba3-b4", "Ba3:b4", "Ba3_b4", "e8Q", "d4", "1e4 e5", "(Nf5),", "the idea is Rxe6."],
  "spaced squares": ["N f 3", "f 3", "e - 4", "Ng1 - f 3", "e.4"],
  "zero-width / invisible splitting": [
    "N​f​3",
    "f​3",
    "f⁠ 3",
    "e­4",
    "e﻿4",
    "e2​e4",
    "Nㅤf3",
    "e\u{E0041}4",
    "e‏4",
  ],
  "full-width and look-alike letters/digits": ["Ｎｆ３", "Nе5", "Nе5", "ｅ４", "ɡ4", "é4", "Нf3", "Νf3", "ｅ2ｅ4", "e④"],
  "unfoldable look-alikes and non-ASCII digits": ["ꜰ3", "Nf٣", "Nf३", "ᴀ3"],
  "castling notation with any dash": ["0-0", "o-o", "O-O", "O-O-O", "0-0-0", "O–O", "O—O", "O−O", "O‒O", "O‑O", "O－O", "О-О", "Ο-Ο", "O​-​O", "o - o"],
  "castling words": ["castle kingside", "castles early", "castling long", "he castled", "Rochade", "roque", "enroque"],
  "UCI-like": ["e2e4", "e7e8q", "e7e8Q", "g1f3"],
  "numbered move sequences": ["1. e4 e5", "12. Qd8", "3... Nf6", "4.. bxc3", "1.e4"],
  "piece word + movement verb": [
    "knight to f five",
    "the rook goes to the back rank",
    "knight takes bishop",
    "the queen was captured",
    "your bishop moves out",
    "the king on the open file",
    "Springer nach vorn",
    "der Springer zieht",
    "le cavalier prend",
    "el caballo captura",
    "la torre en el centro",
  ],
  "capture / push verb + piece": [
    "capture the queen with your knight next move",
    "sacrifice the exchange with the rook",
    "trade queens",
    "push the pawn",
    "advance your king pawn",
    "give up the bishop",
    "you played a queen sortie",
  ],
  "file pawn + movement verb": ["push the h-pawn two squares", "the h-pawn advances", "the g-pawn storm", "the h file pawn marches"],
  "spelled-out squares": ["knight to f five", "e four", "the g-file: g three", "h eight"],
  "REQUIRED 2a: stroked and other non-ASCII letters (no NFKD decomposition)": ["đ4", "ħ5", "ø3", "ł2", "ð4", "þ5", "ß3", "ı4"],
  "REQUIRED 2b: any punctuation or symbol between file and rank": ["e/4", "e·4", "e*4", "e，4", "e(4)", "e|4", "e\\4", "e~4", "e^4", "e=4", "e<4", "e:4", "e;4", "e,4", "Ne/4", "N e * 4", "e ( 4 )", "e\u20ac4"],
  "REQUIRED 2c: spelled-out squares beyond plain digit words": [
    "a two to a four",
    "a two to e four",
    "a two takes",
    "a two, then it goes to",
    "a-one at some point",
    "e fourth",
    "the h fifth",
    "e IV",
    "c iii",
    "g VIII",
    "e cuatro",
    "e quatre",
    "d vier",
    "b tres",
    "c trois",
    "f acht",
    "e dva",
  ],
  "REQUIRED 2d: figurine glyphs": ["\u2658", "\u265B", "\u2654\u2655\u2656\u2657\u2658\u2659", "\u265F", "\u{1FA00}", "then \u2658 moves"],
  "REQUIRED 2e: piece words alone, no verb, plural and possessive, several languages": [
    "the bishop retreats",
    "knight jumps in",
    "the queen trade",
    "promote to a queen",
    "the queen's position",
    "both rooks",
    "kings and pawns",
    "queenside",
    "kingside",
    "the Springer",
    "die Laeufer",
    "el alfil",
    "la reina",
    "le roi",
    "la tour",
    "the slon",
    "peshka",
    "promotion",
    "underpromotion",
    "promotes",
    "en passant",
    "mate in 3",
    "mate in three",
    "discovered check",
  ],
};

/** Ordinary coaching text that is grounded in data and must not trip the strict rule. */
const MUST_PASS = [
  "This is consistent with rushing across 3 games.",
  "You made 3 mistakes at ply 31 with 9s left in game-1.",
  "Solve 10 one-move puzzles with a 15 second limit.",
  "Set a checkpoint at half your time before move 20.",
  "In game-1 and game-2 (ply 41), the clock read 4s.",
  "Your play after a loss changed in 2 of 3 games, which may suggest a pattern.",
  "Take a two minute break, then review the evidence listed below.",
  "This is consistent with a three-game losing streak.",
  "It may suggest a two game losing streak across the sample.",
  "The work is done and gone; 4 of 5 games had under 10s left.",
  "In game-3 at ply 41 you had 6s left, which may suggest time pressure.",
  "The pattern appeared in 12 positions and 3 games.",
];

/** Known, accepted false positives: they only cause a template fallback. Documented so a change is deliberate. */
const KNOWN_FALSE_POSITIVES = [
  "B2B",
  "over a 3 game streak",
  "ply 31. Both games",
  "see H1 report",
  "a tour of the data",
  "a three-game streak at ply 31",
];

describe("containsMoveLikeContent: every rule", () => {
  for (const [rule, payloads] of Object.entries(MUST_FLAG)) {
    for (const p of payloads) {
      it(`${rule}: ${JSON.stringify(p)}`, () => {
        expect(containsMoveLikeContent(p), moveLikeReasons(p).join(",")).toBe(true);
        // and inside a longer harmless sentence
        expect(containsMoveLikeContent(`This may suggest a pattern. ${p} Then review.`)).toBe(true);
      });
    }
  }
  it("passes ordinary data-grounded sentences", () => {
    for (const t of MUST_PASS) expect(moveLikeReasons(t), t).toEqual([]);
  });
  it("documents its known false positives (safe: template fallback)", () => {
    for (const t of KNOWN_FALSE_POSITIVES) expect(containsMoveLikeContent(t), t).toBe(true);
  });
  it("names the rule that fired", () => {
    expect(moveLikeReasons("castle")).toEqual(["castling word"]);
    expect(moveLikeReasons("the queen")).toEqual(["piece word"]);
    expect(moveLikeReasons("Nf3")).toContain("square");
  });
});

describe("normalizeForMoveScan", () => {
  it("folds width, look-alikes, dashes, invisibles and diacritics", () => {
    expect(normalizeForMoveScan("Ｎｆ３")).toBe("nf3");
    expect(normalizeForMoveScan("Nе5")).toBe("ne5");
    expect(normalizeForMoveScan("O–O−O")).toBe("o-o-o");
    expect(normalizeForMoveScan("e​­4")).toBe("e4");
    expect(normalizeForMoveScan("é4")).toBe("e4");
  });
});

// ---------------------------------------------------------------------------------------------
// Property-style fuzz. The oracle is a plain char scan, written independently of validate.ts.
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET: string[] = [
  ..."abcdefghKQRBNkqrbnxyz",
  ..."0123456789",
  ..."x+#=-! ",
  " ",
  " ",
  "​", "‌", "‍", "⁠", "﻿", "­",
  "Ａ", "ｂ", "ｃ", "ｄ", "ｅ", "ｆ", "ｇ", "ｈ", "１", "２", "３", "４", "５", "６", "７", "８",
  "а", "с", "е", "н", "в", "А", "Е", "Н", "В", "С",
  "–", "—", "−",
  "/", "·", "*", "，", "(", ")", "|", "~", "^", ":", ";", ",", "€",
  "đ", "ħ", "ø", "ł", "♘", "♛", "٣",
];

const OR_PUNCT = new Set([..."/·*，()|~^:;,.€=<>_+#!?-–—−"]);

/**
 * Independent oracle (plain char scan, no regex, no shared code with validate.ts). It flags a string when it
 * has a square (file+rank, joined across spaces and punctuation when the file letter is standalone or follows a
 * standalone piece letter), a letter outside plain a-z after folding, a non-ASCII digit, or a figurine glyph.
 */
function oracleFlags(s: string): boolean {
  const zeroWidth = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
  const cyr: Record<string, string> = { "а": "a", "с": "c", "е": "e", "н": "h", "в": "b" };
  const chars: string[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (zeroWidth.has(cp)) continue;
    if (cp >= 0x2654 && cp <= 0x265f) return true; // figurine
    if (cp === 0x0663) return true; // non-ASCII digit
    if ([0x0111, 0x0127, 0x00f8, 0x0142].includes(cp)) return true; // stroked letters (stay non-ASCII after folding)
    let c = cp >= 0xff01 && cp <= 0xff5e ? String.fromCodePoint(cp - 0xfee0) : ch;
    c = c.toLowerCase();
    chars.push(cyr[c] ?? c);
  }
  const isFile = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= "a" && c <= "h";
  const isRank = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= "1" && c <= "8";
  const isDigit = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= "0" && c <= "9";
  const isLetter = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= "a" && c <= "z";
  const isPieceLetter = (c: string | undefined): boolean => c !== undefined && c.length === 1 && "kqrbn".includes(c);
  for (let i = 0; i < chars.length; i++) {
    if (!isFile(chars[i])) continue;
    if (isRank(chars[i + 1]) && !isDigit(chars[i + 2])) return true;
    const standalone = !isLetter(chars[i - 1]) || (isPieceLetter(chars[i - 1]) && !isLetter(chars[i - 2]));
    if (standalone) {
      let j = i + 1;
      while (chars[j] !== undefined && (chars[j] === " " || OR_PUNCT.has(chars[j]!))) j++;
      if (j > i + 1 && isRank(chars[j]) && !isDigit(chars[j + 1])) return true;
    }
  }
  return false;
}

describe("fuzz: nothing the oracle flags gets through", () => {
  it("1000 random strings from a move-like alphabet, plus disguised squares", () => {
    const rnd = mulberry32(20260921);
    let positives = 0;
    let negatives = 0;
    for (let n = 0; n < 1000; n++) {
      const len = 1 + Math.floor(rnd() * 14);
      let s = "";
      for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
      if (oracleFlags(s)) {
        positives++;
        expect(containsMoveLikeContent(s), JSON.stringify(s)).toBe(true);
      } else negatives++;
    }
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const seps = ["", "​", " ", "­", "-", "/", "·", "*", "，", "(", " ( ", "|", "−"];
    for (let n = 0; n < 300; n++) {
      const f = files[Math.floor(rnd() * 8)]!;
      const r = String(1 + Math.floor(rnd() * 8));
      const sep = seps[Math.floor(rnd() * seps.length)]!;
      const wide = rnd() < 0.2;
      const ff = wide ? String.fromCodePoint(f.codePointAt(0)! + 0xfee0) : rnd() < 0.3 ? f.toUpperCase() : f;
      const s = `xx yy ${ff}${sep}${r} tail`;
      expect(oracleFlags(s), `oracle self-check ${JSON.stringify(s)}`).toBe(true);
      expect(containsMoveLikeContent(s), JSON.stringify(s)).toBe(true);
      positives++;
    }
    expect(positives).toBeGreaterThan(200);
    expect(negatives).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------------------------
// validateAdvice: the structured channel
// ---------------------------------------------------------------------------------------------

const clone = (a: CoachAdvice): CoachAdvice => structuredClone(a);

describe("validateAdvice: moves only through mentionedMoves", () => {
  it("accepts engine moves in mentionedMoves in every notation (annotated, checked, full-width glyphs)", () => {
    for (const mv of ["Nf3", "Nf3!", "Nf3+", "Nf3?!", "g1f3", "d1d2", "Nf3！"]) {
      const a = clone(GOOD_ADVICE);
      a.findings[0]!.mentionedMoves = [mv];
      expect(validateAdvice(a, ctx), mv).toEqual({ ok: true });
    }
  });
  it("rejects look-alike, case-changed, spaced or zero-width variants of an engine move in mentionedMoves", () => {
    for (const mv of ["nf3", "N f3", "Nf​3", "Nе3", "Ng1f3", "NF3"]) {
      const a = clone(GOOD_ADVICE);
      a.findings[0]!.mentionedMoves = [mv];
      expect(validateAdvice(a, ctx).ok, JSON.stringify(mv)).toBe(false);
    }
  });
  it("rejects a legitimate engine move once it is written in any free-text field", () => {
    for (const field of ["headline", "explanation", "whatToDo"] as const) {
      const a = clone(GOOD_ADVICE);
      a.findings[0]![field] = `${a.findings[0]![field]} Nf3`;
      expect(validateAdvice(a, ctx).ok, field).toBe(false);
    }
    const s = clone(GOOD_ADVICE);
    s.summary += " Nf3";
    expect(validateAdvice(s, ctx).ok).toBe(false);
  });
  it("treats unknown string fields as free text (fail closed)", () => {
    const a = { ...clone(GOOD_ADVICE), note: "play Qxf7+" } as CoachAdvice;
    expect(validateAdvice(a, ctx).ok).toBe(false);
  });
  it("template mode checks engine membership only", () => {
    const a = clone(GOOD_ADVICE);
    a.findings[0]!.explanation += " You played Nf3, consistent with rushing.";
    expect(validateAdvice(a, ctx, { mode: "template" })).toEqual({ ok: true });
    a.findings[0]!.explanation += " Qxf7 was possible.";
    expect(validateAdvice(a, ctx, { mode: "template" }).ok).toBe(false);
  });
});

describe("prompt", () => {
  it("forbids moves in text and points to mentionedMoves", () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/Never write chess moves, and never name chess pieces, in any text field/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/"mentionedMoves"/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/castling/);
  });
});

describe("referencedMovesByFinding (what the UI stores and shows)", () => {
  const withMoves = (moves: string[]): CoachAdvice => {
    const a = clone(GOOD_ADVICE);
    a.findings[0]!.mentionedMoves = moves;
    return a;
  };
  const first = (a: CoachAdvice) => referencedMovesByFinding(a, ctx)["f-time"];

  it("stores the normalised form, never the raw model string", () => {
    const glyphs = withMoves(["Nf3!!!!!!!!!!!!"]);
    expect(validateAdvice(glyphs, ctx)).toEqual({ ok: true }); // passes validation...
    expect(first(glyphs)).toEqual(["Nf3"]); // ...but only the short normalised move is kept
  });
  it("trims whitespace and folds full-width variants", () => {
    expect(first(withMoves(["  Nf3  ", "\tg1f3\n", "Ｎｆ３", "Nf3 ! ?"]))).toEqual(["Nf3", "g1f3"]);
  });
  it("deduplicates", () => {
    expect(first(withMoves(["Nf3", "Nf3+", "Nf3!", "d1d2", "d1d2"]))).toEqual(["Nf3", "d1d2"]);
  });
  it("drops non-members and caps an over-long list", () => {
    expect(first(withMoves(["Nf3", "Qxf7", "Ra8"]))).toEqual(["Nf3"]);
    const many = Array.from({ length: 500 }, () => "Nf3").concat(["d1d2"]);
    expect(first(withMoves(many))).toEqual(["Nf3", "d1d2"]);
    expect(MAX_REFERENCED_MOVES).toBeLessThanOrEqual(8);
    expect(first(withMoves([]))).toBeUndefined();
  });
  it("every stored move is short enough for the result schema", () => {
    const out = first(withMoves(["Nf3!!!!!!!!!!!!!!!!!!!!", "d1d2?!?!?!?!?!?!?!?!?!"]))!;
    for (const m of out) expect(m.length).toBeLessThanOrEqual(12);
  });
});

describe("emotion claims are also checked on normalised text (evasion)", () => {
  it("rejects a zero-width or look-alike split emotion claim", () => {
    for (const t of ["You were fr​ustrated, consistent with a streak.", "You were ｎｅｒｖｏｕｓ, consistent with a streak.", "You were tіlted, consistent with a streak."]) {
      const a = clone(GOOD_ADVICE);
      a.findings[0]!.explanation = t;
      expect(validateAdvice(a, ctx).ok, t).toBe(false);
    }
  });
});
