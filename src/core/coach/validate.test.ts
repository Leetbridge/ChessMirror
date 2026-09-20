import { describe, expect, it } from "vitest";
import { COACH_SYSTEM_PROMPT } from "./prompts";
import { containsMoveLikeContent, moveLikeReasons, normalizeForMoveScan, validateAdvice } from "./validate";
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
];

/** Known, accepted false positives: they only cause a template fallback. Documented so a change is deliberate. */
const KNOWN_FALSE_POSITIVES = ["B2B", "over a 3 game streak", "ply 31. Both games", "see H1 report"];

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
];

/** Independent oracle: canonicalise char by char, drop invisibles, then scan for [a-h][1-8] not followed by a digit. */
function oracleHasSquare(s: string): boolean {
  const zeroWidth = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
  const cyr: Record<string, string> = { "а": "a", "с": "c", "е": "e", "н": "h", "в": "b" };
  const chars: string[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (zeroWidth.has(cp)) continue;
    let c = cp >= 0xff01 && cp <= 0xff5e ? String.fromCodePoint(cp - 0xfee0) : ch;
    c = c.toLowerCase();
    chars.push(cyr[c] ?? c);
  }
  const isFile = (c: string | undefined): boolean => c !== undefined && c >= "a" && c <= "h" && c.length === 1;
  const isRank = (c: string | undefined): boolean => c !== undefined && c >= "1" && c <= "8" && c.length === 1;
  const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9" && c.length === 1;
  const isLetter = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= "a" && c <= "z";
  for (let i = 0; i < chars.length; i++) {
    if (!isFile(chars[i])) continue;
    // adjacent file + rank
    if (isRank(chars[i + 1]) && !isDigit(chars[i + 2])) return true;
    // single file letter (not part of a word), then whitespace/dashes, then a rank
    if (!isLetter(chars[i - 1])) {
      let j = i + 1;
      while (chars[j] === " " || chars[j] === "-" || chars[j] === "–" || chars[j] === "—" || chars[j] === "−") j++;
      if (j > i + 1 && isRank(chars[j]) && !isDigit(chars[j + 1])) return true;
    }
  }
  return false;
}

describe("fuzz: no string with a valid square gets through", () => {
  it("600 random strings from a move-like alphabet, plus targeted mutations", () => {
    const rnd = mulberry32(20260920);
    let positives = 0;
    let negatives = 0;
    for (let n = 0; n < 600; n++) {
      const len = 1 + Math.floor(rnd() * 14);
      let s = "";
      for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
      if (oracleHasSquare(s)) {
        positives++;
        expect(containsMoveLikeContent(s), JSON.stringify(s)).toBe(true);
      } else negatives++;
    }
    // targeted: a real square with a random disguise, embedded in random filler
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const disguises = [
      (f: string, r: string) => `${f}${r}`,
      (f: string, r: string) => `${f}​${r}`,
      (f: string, r: string) => `${f} ${r}`,
      (f: string, r: string) => `${f}­${r}`,
      (f: string, r: string) => String.fromCodePoint(f.codePointAt(0)! + 0xfee0) + String.fromCodePoint(r.codePointAt(0)! + 0xfee0),
      (f: string, r: string) => `${f.toUpperCase()}${r}`,
      (f: string, r: string) => `play${f}${r}`,
      (f: string, r: string) => `${f}-${r}`,
    ];
    for (let n = 0; n < 200; n++) {
      const f = files[Math.floor(rnd() * 8)]!;
      const r = String(1 + Math.floor(rnd() * 8));
      const d = disguises[Math.floor(rnd() * disguises.length)]!;
      const pre = "abcdefghijklmnopqrstuvwxyz ".repeat(1).slice(0, Math.floor(rnd() * 5));
      const s = `${pre} ${d(f, r)} tail`;
      expect(oracleHasSquare(s), `oracle self-check ${JSON.stringify(s)}`).toBe(true);
      expect(containsMoveLikeContent(s), JSON.stringify(s)).toBe(true);
      positives++;
    }
    expect(positives).toBeGreaterThan(100);
    expect(negatives).toBeGreaterThan(50); // the fuzz is not all-positive
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
    expect(COACH_SYSTEM_PROMPT).toMatch(/Never write chess moves in any text field/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/"mentionedMoves"/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/castling/);
  });
});
