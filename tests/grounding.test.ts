/**
 * Grounding test: the engine is truth, the LLM is teacher.
 *
 * Principle under test (CLAUDE.md): the LLM must never introduce a chess move that is not in
 * the engine/analysis output. This drives the real chain
 *   PGN fixture -> parsePgnText -> getPositions -> (scripted) engine -> classifyGame -> detectHabits
 *   -> buildCoachContext -> explainFindings (mocked LlmProvider)
 * with a hostile mock LLM that tries to smuggle in invented moves in many ways.
 *
 * Structure
 *  - "rejected" payloads must fall back to the template with a reason, and the invented move must not
 *    appear in the final output.
 *  - the control (only engine moves) must be accepted, so the suite is not "reject everything".
 *  - a canary runs the same scenarios through a NON-validating path and asserts that the grounding
 *    oracle detects the invented move. If the oracle were vacuous, that test would fail.
 *  - the former "known bypass" payloads (formerly it.fails) are now ordinary rejections. Design: the LLM may
 *    name moves only via `mentionedMoves` (exact match against engine data); free text must contain no
 *    move-like content (`containsMoveLikeContent`), so a legitimate engine move in free text is rejected too.
 */
import { Chess } from "chess.js";
import { beforeAll, describe, expect, it } from "vitest";
import { classifyGame, getPositions } from "../src/core/classify";
import {
  aliasContext,
  allowedMoves,
  buildCoachContext,
  explainFindings,
  extractMoveTokens,
  templateAdvice,
  validateAdvice,
  type CoachAdvice,
  type CoachContext,
  type CoachResult,
  type LlmProvider,
} from "../src/core/coach";
import { CoachAdviceSchema } from "../src/core/coach/advice";
import { fakeProvider } from "../src/core/coach/evals/fake-provider";
import { detectedFindings, normalizeMove } from "../src/core/coach/context";
import type { AnalyzedGame, PositionEval } from "../src/core/domain";
import type { EngineAnalyzer } from "../src/core/engine";
import { detectHabits } from "../src/core/habits";
import { parsePgnText } from "../src/core/import";
import { FakeEngine, copies, materialEval } from "./helpers";

// ---------------------------------------------------------------------------------------------
// Scenario construction (real pipeline, fake engine)
// ---------------------------------------------------------------------------------------------

/**
 * Scripted engine: material balance, but from move 17 on every move swings the eval by 10 pawns
 * against the mover. Gives the time-trouble detector real blunders under a low clock.
 */
const swingEngine: EngineAnalyzer = {
  async analyze(fen: string): Promise<PositionEval> {
    const base = materialEval(fen);
    const parts = fen.split(" ");
    if (Number(parts[5]) >= 17) return { ...base, evalCp: parts[1] === "b" ? -500 : 500 };
    return base;
  },
  async close() {},
};

interface Scenario {
  name: string;
  ctx: CoachContext; // real ids
  safe: CoachContext; // alias ids (what the LLM sees and validation runs on)
  allowed: Set<string>;
  /** A legal move at one evidence position that is NOT in the engine data. */
  legalNotInData: string;
}

async function build(name: string, file: string, engine: EngineAnalyzer, n = 6): Promise<Scenario> {
  const games = parsePgnText(copies(file, n), { source: "lichess", username: "SyntheticHero" }).games;
  const analyzed: AnalyzedGame[] = [];
  for (const g of games) {
    const evals: (PositionEval | null)[] = [];
    for (const p of getPositions(g)) evals.push(p.terminal ? null : await engine.analyze(p.fen, { depth: 12 }));
    analyzed.push(classifyGame(g, evals, { engineName: "FakeFish 1" }));
  }
  const findings = detectHabits(analyzed);
  const ctx = buildCoachContext(findings, analyzed);
  const allowed = allowedMoves(ctx);
  const safe = aliasContext(ctx).ctx;

  const mv = ctx.moves[0];
  if (!mv) throw new Error(`scenario ${name}: no engine moves in context`);
  const g = games.find((x) => x.id === mv.gameId)!;
  const fenBefore = getPositions(g)[mv.ply - 1]!.fen;
  const legal = new Chess(fenBefore).moves({ verbose: true });
  const alt = legal.find((m) => !allowed.has(m.san.replace(/[+#]$/, "")) && !allowed.has(m.lan));
  if (!alt) throw new Error(`scenario ${name}: no legal alternative`);
  return { name, ctx, safe, allowed, legalNotInData: alt.san };
}

let scenarios: Scenario[] = [];
beforeAll(async () => {
  scenarios = [
    await build("thrown-wins", "pgn/winning_position_thrown_away.pgn", new FakeEngine()),
    await build("no-resignation", "pgn/lost_game_played_to_mate.pgn", new FakeEngine()),
    await build("time-trouble", "pgn/time_trouble_blunder_timeout.pgn", swingEngine),
  ];
});

// ---------------------------------------------------------------------------------------------
// The mocked LLM and helpers
// ---------------------------------------------------------------------------------------------

/** A well-behaved answer in alias space, built ONLY from the supplied engine data. */
function goodAdvice(safe: CoachContext): CoachAdvice {
  return {
    summary: `${detectedFindings(safe).length} recurring pattern found; these are hypotheses, not certainties.`,
    findings: detectedFindings(safe).map((f) => {
      const ref = f.evidence[0]!;
      const mv = safe.moves.find((m) => m.gameId === ref.gameId && m.ply === ref.ply)!;
      const best = mv.bestSan ?? mv.bestUci;
      return {
        findingId: f.id,
        headline: `Pattern in ${f.evidence.length} positions`,
        explanation:
          `In ${f.evidence.length} positions (${ref.gameId} ply ${ref.ply}) the engine preferred a different move ` +
          `than the one you played (both listed as referenced moves). This is consistent with a recurring pattern.`,
        whatToDo: "Review the position above and write down two candidate moves before you play.",
        citedRefs: [{ gameId: ref.gameId, ply: ref.ply }],
        mentionedMoves: best ? [mv.playedSan, best] : [mv.playedSan],
      };
    }),
  };
}

type TextField = "summary" | "headline" | "explanation" | "whatToDo";
const TEXT_FIELDS: TextField[] = ["summary", "headline", "explanation", "whatToDo"];

/** Append hostile text to one field of the first finding (or the summary). */
function inject(base: CoachAdvice, field: TextField, text: string): CoachAdvice {
  const a: CoachAdvice = structuredClone(base);
  const f = a.findings[0]!;
  if (field === "summary") a.summary = `${a.summary} Then ${text} next.`;
  else f[field] = `${f[field]} Then ${text} next.`;
  return a;
}

function run(s: Scenario, advice: unknown): Promise<CoachResult & { calls: number }> {
  let calls = 0;
  const provider: LlmProvider = fakeProvider(() => {
    calls += 1;
    return advice;
  });
  return explainFindings(s.ctx, { provider }).then((r) => ({ ...r, calls }));
}

function outputStrings(a: CoachAdvice): string[] {
  const out = [a.summary];
  for (const f of a.findings) {
    out.push(f.findingId, f.headline, f.explanation, f.whatToDo, ...f.mentionedMoves);
    for (const r of f.citedRefs) out.push(r.gameId);
  }
  return out;
}

/** What a human would read: NFKC (folds full-width forms) and zero-width / soft-hyphen chars removed. */
function humanView(s: string): string {
  return s.normalize("NFKC").replace(/[​-‏⁠﻿­]/g, "");
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function containsWord(hay: string, needle: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(needle)}(?![A-Za-z0-9])`).test(hay);
}

/**
 * The grounding oracle, independent of validateAdvice. A violation is
 *  - the invented string appearing verbatim (or after human-view normalisation), or
 *  - any move token, seen through extractMoveTokens on the human view, that is not engine data.
 */
function violations(advice: CoachAdvice, allowed: Set<string>, needle?: string): string[] {
  const v: string[] = [];
  for (const s of outputStrings(advice)) {
    const h = humanView(s);
    if (needle !== undefined) {
      if (containsWord(s, needle) || containsWord(h, humanView(needle))) v.push(`invented string present: ${needle}`);
    }
    for (const tok of extractMoveTokens(h)) if (!allowed.has(tok)) v.push(`move token not in engine data: ${tok}`);
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------------------------

interface Payload {
  label: string;
  text: string | ((s: Scenario) => string);
}
const resolve = (p: Payload, s: Scenario): string => (typeof p.text === "string" ? p.text : p.text(s));

/** Every one of these must be rejected by the real pipeline. */
const REJECTED: Payload[] = [
  { label: "SAN check in free text", text: "play Qxf7+" },
  { label: "SAN mate", text: "Qxf7#" },
  { label: "UCI", text: "e2e4" },
  { label: "UCI with promotion", text: "e7e8q" },
  { label: "castling short", text: "O-O" },
  { label: "castling long", text: "O-O-O" },
  { label: "promotion", text: "e8=Q" },
  { label: "promotion with capture", text: "exd8=N+" },
  { label: "SAN with annotation glyph", text: "Nf3!?" },
  { label: "SAN with double question", text: "Bxh7??" },
  { label: "disambiguated SAN", text: "Nbd7" },
  { label: "move number sequence", text: "1.e4 e5 2.Nf3" },
  { label: "move number sequence with dots", text: "1. e4 e5 2. Nf3 Nc6 3. Bb5" },
  { label: "SAN glued to punctuation", text: "(Nf5)," },
  { label: "SAN sentence-final", text: "the idea is Rxe6." },
  { label: "SAN queen move", text: "Qh5" },
  { label: "prose with a square (knight to f5) is over-caught as a pawn token", text: "knight to f5 attacks the queen" },
  { label: "prose with a square (rook to e8)", text: "move the rook to e8" },
  { label: "bare pawn move", text: "d4" },
  { label: "long algebraic full invented", text: "Ng1-f3" },
  { label: "legal in position but not in engine data", text: (s) => s.legalNotInData },
  { label: "legal-not-in-data as UCI-like phrase", text: (s) => `try ${s.legalNotInData} instead` },
  { label: "ZWSP inside UCI", text: "e2​e4" },
  { label: "ZWSP between piece letter and squares of a capture", text: "Qx​f7" },
  // --- formerly known bypasses (were it.fails before the strict free-text rule) ---
  { label: "lowercase SAN (qxf7+)", text: "qxf7+" },
  { label: "lowercase knight (nf3)", text: "nf3" },
  { label: "upper-case shouted SAN (QXF7)", text: "QXF7" },
  { label: "SAN glued to a preceding letter (playNf5)", text: "playNf5" },
  { label: "spaced SAN (N f 3)", text: "N f 3" },
  { label: "zero-width between every character (N-ZWSP-f-ZWSP-3)", text: "N​f​3" },
  { label: "full-width look-alike (Ｎｆ３)", text: "Ｎｆ３" },
  { label: "Cyrillic e look-alike (Nе5, U+0435)", text: "Nе" + "5" },
  { label: "prose without coordinates: capture with the knight", text: "capture the queen with your knight next move" },
  { label: "prose with spelled-out squares (knight to f-five)", text: "knight to f five" },
  { label: "digit-zero castling (0-0)", text: "0-0" },
  { label: "lowercase castling (o-o)", text: "o-o" },
  { label: "en-dash castling (O–O)", text: "O–O" },
  { label: "promotion without equals (e8Q)", text: "e8Q" },
  { label: "upper-case UCI promotion (e7e8Q)", text: "e7e8Q" },
  { label: "German notation (Sf3)", text: "Sf3" },
  { label: "Spanish notation (Cf3)", text: "Cf3" },
  { label: "German queen capture (Dxf7)", text: "Dxf7" },
  { label: "prose pawn push without coordinates", text: "push the h-pawn two squares" },
  // --- new payloads, one or more per rule ---
  { label: "long-algebraic hop (Ba3-b4)", text: "Ba3-b4" },
  { label: "colon separator (Ba3:b4)", text: "Ba3:b4" },
  { label: "underscore separator (Ba3_b4)", text: "Ba3_b4" },
  { label: "en-dash separator (Ba3-b4 with U+2013)", text: "Ba3–b4" },
  { label: "digit fused to square (1e4)", text: "1e4 e5" },
  { label: "Greek omicron castling", text: "Ο-Ο" },
  { label: "Cyrillic O castling", text: "О-О" },
  { label: "minus-sign castling", text: "O−O" },
  { label: "figure-dash long castling", text: "O‒O‒O" },
  { label: "non-breaking hyphen castling", text: "0‑0" },
  { label: "ZWSP inside castling", text: "O​-​O" },
  { label: "castling word", text: "castle kingside now" },
  { label: "German castling word", text: "Rochade" },
  { label: "soft hyphen inside a square", text: "e­4" },
  { label: "word joiner + space inside a square", text: "f⁠ 3" },
  { label: "Hangul filler between piece and square", text: "Nㅤf3" },
  { label: "combining accent on the file letter", text: "é4" },
  { label: "Latin script-g look-alike", text: "ɡ1" },
  { label: "small-capital look-alike", text: "ꜰ3" },
  { label: "Arabic-Indic rank digit", text: "Nf٣" },
  { label: "hyphenated file-rank (e-4)", text: "e-4" },
  { label: "numbered sequence (12. Qd8)", text: "12. Qd8" },
  { label: "piece + verb (rook goes)", text: "the rook goes to the back rank" },
  { label: "piece takes piece", text: "knight takes bishop" },
  { label: "passive capture", text: "the queen was captured" },
  { label: "French prose", text: "le cavalier prend" },
  { label: "German prose", text: "der Springer zieht nach vorn" },
  { label: "Spanish prose", text: "el caballo captura" },
  { label: "trade phrase", text: "trade queens" },
  { label: "sacrifice phrase", text: "sacrifice the exchange with the rook" },
  { label: "file pawn advance", text: "the h-pawn advances" },
  { label: "spelled-out square (e four)", text: "e four" },
  // --- reviewer round 2 ---
  { label: "stroked letter (d-bar 4)", text: "\u01114" },
  { label: "stroked letter (h-bar 5)", text: "\u01275" },
  { label: "slash separator", text: "e/4" },
  { label: "middle-dot separator", text: "e\u00b74" },
  { label: "full-width comma separator", text: "e\uff0c4" },
  { label: "parenthesised rank", text: "e(4)" },
  { label: "a-file spelled squares", text: "a two to a four" },
  { label: "ordinal square", text: "e fourth" },
  { label: "roman-numeral square", text: "e IV" },
  { label: "Spanish digit word square", text: "e cuatro" },
  { label: "figurine glyph", text: "\u2658\u265b" },
  { label: "piece word, no verb (bishop retreats)", text: "the bishop retreats" },
  { label: "piece word (knight jumps in)", text: "knight jumps in" },
  { label: "promotion prose", text: "promote to a queen" },
  { label: "underpromotion", text: "underpromotion" },
  { label: "en passant", text: "en passant" },
  { label: "mate in N", text: "mate in three" },
  { label: "discovered check", text: "discovered check" },
];

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe("scenarios come from the real pipeline", () => {
  it("each scenario has detected findings and engine moves", () => {
    expect(scenarios.map((s) => s.name)).toEqual(["thrown-wins", "no-resignation", "time-trouble"]);
    for (const s of scenarios) {
      expect(detectedFindings(s.ctx).length, s.name).toBeGreaterThan(0);
      expect(s.ctx.moves.length, s.name).toBeGreaterThan(0);
      expect(s.allowed.size, s.name).toBeGreaterThan(0);
    }
  });

  it("injected payloads are genuinely not engine data in any scenario", () => {
    for (const s of scenarios) {
      // Hop payloads start with an engine move on purpose (allowed source square, invented destination).
      for (const p of REJECTED.filter((x) => !/^(?:long-algebraic hop|colon|underscore|en-dash separator)/.test(x.label))) {
        const t = resolve(p, s);
        for (const tok of extractMoveTokens(t)) {
          expect(s.allowed.has(tok), `${s.name}: '${p.label}' token ${tok} is unexpectedly allowed`).toBe(false);
        }
      }
    }
  });
});

describe("control: only engine moves are accepted (suite is not reject-everything)", () => {
  it("accepts the good advice and every move token in the output is engine data", async () => {
    for (const s of scenarios) {
      const advice = goodAdvice(s.safe);
      const res = await run(s, advice);
      expect(res.source, `${s.name}: ${res.fallbackReason}`).toBe("llm");
      expect(res.fallbackReason).toBeUndefined();
      expect(res.calls).toBe(1);
      const all = outputStrings(res.advice);
      const tokens = all.flatMap((t) => extractMoveTokens(t));
      expect(tokens.length, "control must actually mention engine moves").toBeGreaterThan(0);
      for (const tok of tokens) expect(s.allowed.has(tok), `${s.name}: ${tok}`).toBe(true);
      expect(violations(res.advice, s.allowed)).toEqual([]);
      // real ids are restored on the way out
      expect(res.advice.findings[0]!.citedRefs[0]!.gameId).toMatch(/^lichess:/);
    }
  });

  it("accepts engine moves in every notation the data allows when they are in mentionedMoves ONLY", async () => {
    for (const s of scenarios) {
      const mv = s.safe.moves[0]!;
      const variants = [mv.playedSan, `${mv.playedSan}!`, `${mv.playedSan}+`, mv.playedUci, mv.bestSan, mv.bestUci].filter(
        (x): x is string => x !== undefined,
      );
      for (const v of variants) {
        const a = goodAdvice(s.safe);
        a.findings[0]!.mentionedMoves = [v];
        const res = await run(s, a);
        expect(res.source, `${s.name}: ${v}: ${res.fallbackReason}`).toBe("llm");
        expect(res.advice.findings[0]!.mentionedMoves).toEqual([v]);
        expect(violations(res.advice, s.allowed)).toEqual([]);
      }
    }
  });

  it("BEHAVIOUR CHANGE: the same legitimate engine moves written in free text are now REJECTED", async () => {
    for (const s of scenarios) {
      const mv = s.safe.moves[0]!;
      const variants = [mv.playedSan, `${mv.playedSan}!`, `${mv.playedSan}+`, mv.playedUci, mv.bestSan, mv.bestUci].filter(
        (x): x is string => x !== undefined,
      );
      for (const v of variants) {
        for (const field of TEXT_FIELDS) {
          const res = await run(s, inject(goodAdvice(s.safe), field, `compare ${v} with what happened`));
          expect(res.source, `${s.name}/${field}: ${v}`).toBe("template");
          expect(res.fallbackReason).toMatch(/move-like content in free text/);
        }
      }
    }
  });

  it("template fallback output is itself grounded", () => {
    for (const s of scenarios) {
      const t = templateAdvice(s.ctx);
      expect(violations(t, s.allowed), s.name).toEqual([]);
      // The template is our own text: validated by engine membership only, never by the strict free-text rule.
      expect(validateAdvice(t, s.ctx, { mode: "template" }), s.name).toEqual({ ok: true });
    }
  });
});

describe("invented moves are rejected and never reach the output", () => {
  for (const p of REJECTED) {
    it(`${p.label}`, async () => {
      for (const s of scenarios) {
        const text = resolve(p, s);
        for (const field of TEXT_FIELDS) {
          const res = await run(s, inject(goodAdvice(s.safe), field, text));
          const where = `${s.name}/${field}`;
          expect(res.calls, where).toBe(1); // the LLM was consulted, so this is a validation fallback
          expect(res.source, where).toBe("template");
          expect(res.fallbackReason, where).toMatch(/^validation failed: /);
          expect(violations(res.advice, s.allowed, text), where).toEqual([]);
        }
        // declared in mentionedMoves
        const a = goodAdvice(s.safe);
        a.findings[0]!.mentionedMoves.push(text);
        const res = await run(s, a);
        expect(res.source, `${s.name}/mentionedMoves`).toBe("template");
        expect(res.fallbackReason).toMatch(/declared move not in engine data/);
        expect(violations(res.advice, s.allowed, text)).toEqual([]);
      }
    });
  }

  it("invented move inside citedRefs / finding ids is rejected", async () => {
    for (const s of scenarios) {
      const a = goodAdvice(s.safe);
      a.findings[0]!.citedRefs[0]!.gameId = "Qxf7+";
      let res = await run(s, a);
      expect(res.source).toBe("template");
      expect(res.fallbackReason).toMatch(/cites ref not in its evidence/);
      expect(violations(res.advice, s.allowed, "Qxf7+")).toEqual([]);

      const b = goodAdvice(s.safe);
      b.findings[0]!.findingId = "e2e4";
      res = await run(s, b);
      expect(res.source).toBe("template");
      expect(res.fallbackReason).toMatch(/unknown findingId/);
      expect(violations(res.advice, s.allowed, "e2e4")).toEqual([]);

      const c = goodAdvice(s.safe);
      c.findings.push({ ...structuredClone(c.findings[0]!), findingId: "Nf3" });
      res = await run(s, c);
      expect(res.source).toBe("template");
      expect(violations(res.advice, s.allowed, "Nf3")).toEqual([]);
    }
  });

  it("schema-violating output (moves smuggled as wrong types / extra keys) falls back", async () => {
    for (const s of scenarios) {
      const a = goodAdvice(s.safe);
      const bad = [
        { ...a, findings: [{ ...a.findings[0]!, mentionedMoves: "Qxf7+" }] },
        { ...a, extraMove: "Qxf7+" }, // extra key: stripped by zod, so must not surface
      ];
      const r0 = await run(s, bad[0]);
      expect(r0.source).toBe("template");
      expect(r0.fallbackReason).toMatch(/schema validation/);
      expect(JSON.stringify(r0.advice)).not.toContain("Qxf7");
      const r1 = await run(s, bad[1]);
      expect(JSON.stringify(r1.advice)).not.toContain("Qxf7");
    }
  });

  it("property: no output string of any rejected/control run contains a non-engine move", async () => {
    let checked = 0;
    for (const s of scenarios) {
      const outputs: CoachAdvice[] = [];
      outputs.push((await run(s, goodAdvice(s.safe))).advice);
      for (const p of REJECTED) {
        const text = resolve(p, s);
        for (const field of TEXT_FIELDS) outputs.push((await run(s, inject(goodAdvice(s.safe), field, text))).advice);
      }
      for (const out of outputs) {
        for (const str of outputStrings(out)) {
          for (const tok of extractMoveTokens(humanView(str))) {
            expect(s.allowed.has(tok), `${s.name}: '${tok}' in '${str.slice(0, 80)}'`).toBe(true);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("CANARY: the grounding oracle is not vacuous", () => {
  /** A deliberately broken copy of explainFindings that never calls validateAdvice. */
  async function unvalidatedExplain(s: Scenario, provider: LlmProvider): Promise<CoachAdvice> {
    const { ctx: safe, restore } = aliasContext(s.ctx);
    const advice = await provider.generate({ system: "", prompt: "", schema: CoachAdviceSchema });
    void safe;
    return restore(CoachAdviceSchema.parse(advice));
  }

  /** A weak validator: checks only declared mentionedMoves, not free text. */
  async function mentionedOnlyExplain(s: Scenario, provider: LlmProvider): Promise<CoachAdvice | "template"> {
    const { ctx: safe, restore } = aliasContext(s.ctx);
    const advice = CoachAdviceSchema.parse(await provider.generate({ system: "", prompt: "", schema: CoachAdviceSchema }));
    for (const f of advice.findings) for (const m of f.mentionedMoves) if (!allowedMoves(safe).has(normalizeMove(m))) return "template";
    return restore(advice);
  }

  it("without validation, every rejected payload is detected as a violation by the oracle", async () => {
    for (const s of scenarios) {
      for (const p of REJECTED) {
        const text = resolve(p, s);
        for (const field of TEXT_FIELDS) {
          const advice = inject(goodAdvice(s.safe), field, text);
          const out = await unvalidatedExplain(s, fakeProvider(() => advice));
          const v = violations(out, s.allowed, text);
          expect(v.length, `oracle missed '${p.label}' in ${s.name}/${field}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the oracle finds the invented move in the real validator's own decision boundary", async () => {
    // Same payload, real path: rejected. Broken path: leaks. Difference proves validateAdvice does the work.
    const s = scenarios[0]!;
    const advice = inject(goodAdvice(s.safe), "explanation", "play Qxf7+");
    const real = await run(s, advice);
    const broken = await unvalidatedExplain(s, fakeProvider(() => advice));
    expect(real.source).toBe("template");
    expect(violations(real.advice, s.allowed, "Qxf7+")).toEqual([]);
    expect(violations(broken, s.allowed, "Qxf7+").length).toBeGreaterThan(0);
    expect(validateAdvice(advice, s.safe).ok).toBe(false);
  });

  it("a validator that only checks mentionedMoves lets free-text injection through and the oracle catches it", async () => {
    const s = scenarios[0]!;
    const advice = inject(goodAdvice(s.safe), "explanation", "play Qxf7+");
    const out = await mentionedOnlyExplain(s, fakeProvider(() => advice));
    expect(out).not.toBe("template");
    if (out !== "template") expect(violations(out, s.allowed, "Qxf7+").length).toBeGreaterThan(0);
  });

  it("the control produces zero violations on the broken path too (oracle has no false positives)", async () => {
    for (const s of scenarios) {
      const out = await unvalidatedExplain(s, fakeProvider(() => goodAdvice(s.safe)));
      expect(violations(out, s.allowed)).toEqual([]);
    }
  });
});

describe("former known bypasses, now rejections (no it.fails left)", () => {
  it("every former bypass payload falls back to the template, in every text field of every scenario", async () => {
    const former = REJECTED.slice(REJECTED.findIndex((p) => p.label.startsWith("lowercase SAN")));
    expect(former.length).toBeGreaterThanOrEqual(19);
    for (const p of former) {
      for (const s of scenarios) {
        for (const field of TEXT_FIELDS) {
          const res = await run(s, inject(goodAdvice(s.safe), field, resolve(p, s)));
          expect(res.source, `${p.label} in ${s.name}/${field}`).toBe("template");
          expect(violations(res.advice, s.allowed, resolve(p, s)), p.label).toEqual([]);
        }
      }
    }
  });

  it("long-algebraic hop: an allowed source square no longer hides an invented destination (Ba3-b4)", async () => {
    const s = scenarios[0]!;
    // "Ba3" style engine data is allowed on its own (in mentionedMoves) but the hop in free text is not.
    const allowedSan = [...s.allowed].find((m) => /^[KQRBN][a-h][1-8]$/.test(m));
    const hop = allowedSan ? `${allowedSan}-b4` : "Ba3-b4";
    const res = await run(s, inject(goodAdvice(s.safe), "explanation", hop));
    expect(res.source).toBe("template");
  });

  it("undeclared prose move without notation is rejected when it uses a capture phrase", async () => {
    const s = scenarios[0]!;
    const a = goodAdvice(s.safe);
    a.findings[0]!.explanation += " Better was to capture the queen with the knight, giving a strong attack.";
    const res = await run(s, a);
    expect(res.source).toBe("template");
  });
});

describe("RESIDUAL RISK: pure prose with no square, notation or piece phrase cannot be excluded by any regex", () => {
  // Not a test of desired behaviour: it records that this class exists, so nobody claims airtightness.
  // The prompt forbids it; see docs/KNOWN-LIMITATIONS.md. If this starts failing (rejected), tighten the docs, not the test.
  it("documented example is accepted as source 'llm' (kept honest here)", async () => {
    const s = scenarios[0]!;
    const a = goodAdvice(s.safe);
    a.findings[0]!.explanation += " Retreating one step to the left would have avoided the loss.";
    const res = await run(s, a);
    expect(res.source).toBe("llm");
  });
});
