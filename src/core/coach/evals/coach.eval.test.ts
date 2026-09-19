import { describe, expect, it } from "vitest";
import { explainFindings } from "../coach";
import { checkGrounding } from "../grounding";
import { validateAdvice } from "../validate";
import { resolveProvider } from "../registry";
import { templateAdvice } from "../template";
import { ctx } from "./fixtures";
import { GENERIC_ADVICE, GOOD_ADVICE, fakeProvider } from "./fake-provider";

/**
 * Offline evals (fake provider) plus an optional live eval when ANTHROPIC_API_KEY is set.
 * Core property: advice cites the player's own data (games, plies, counts, clock times).
 */
describe("eval: advice is grounded in the player's own data (offline)", () => {
  it("template advice is grounded", () => {
    const g = checkGrounding(templateAdvice(ctx), ctx);
    expect(g.findings.map((f) => f.kinds)).toEqual([expect.arrayContaining(["game", "ply", "count"]), expect.arrayContaining(["game", "ply", "count"])]);
    expect(g.ok).toBe(true);
  });
  it("a good model answer is grounded", () => {
    expect(checkGrounding(GOOD_ADVICE, ctx).ok).toBe(true);
  });
  it("the eval discriminates: generic tips pass validation but fail grounding", () => {
    expect(validateAdvice(GENERIC_ADVICE, ctx)).toEqual({ ok: true });
    const g = checkGrounding(GENERIC_ADVICE, ctx);
    expect(g.ok).toBe(false);
    expect(g.findings.every((f) => f.genericPhrases.length > 0)).toBe(true);
  });
  it("advice built with different data changes with the data (not boilerplate)", () => {
    const other = { ...ctx, findings: ctx.findings.map((f) => (f.status === "detected" && f.id === "f-time" ? { ...f, evidence: f.evidence.slice(0, 1) } : f)) };
    const a = templateAdvice(ctx).findings[0]?.explanation;
    const b = templateAdvice(other).findings[0]?.explanation;
    expect(a).not.toEqual(b);
    expect(a).toContain("3 positions across 2 games");
    expect(b).toContain("1 position across 1 game");
  });
});

const liveKey = process.env["ANTHROPIC_API_KEY"];
describe.skipIf(!liveKey)("eval: live provider (needs ANTHROPIC_API_KEY)", () => {
  it("returns validated, grounded advice or a template that is", async () => {
    const provider = resolveProvider(process.env);
    expect(provider?.name).toBe("anthropic");
    const r = await explainFindings(ctx, provider ? { provider } : {});
    // A live model may legitimately fail post-validation; the fallback must still be grounded.
    console.info(`live coach source=${r.source} reason=${r.fallbackReason ?? "-"}`);
    expect(validateAdvice(r.advice, ctx)).toEqual({ ok: true });
    expect(checkGrounding(r.advice, ctx).ok).toBe(true);
  }, 120_000);
});

describe("eval: fallback still grounded when the model misbehaves", () => {
  it("generic output is not rejected by validation, so grounding is the guard the eval provides", async () => {
    const r = await explainFindings(ctx, { provider: fakeProvider(() => GENERIC_ADVICE) });
    expect(r.source).toBe("llm");
    expect(checkGrounding(r.advice, ctx).ok).toBe(false);
  });
});
