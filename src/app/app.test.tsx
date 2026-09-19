import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FindingCard } from "./components/FindingCard";
import { StateMessage } from "./components/StateMessage";
import { PlanContent } from "./components/PlanView";
import { FindingsList } from "./components/DashboardView";
import { buildRequest } from "./components/ImportForm";
import { buildMockResult, createMockService } from "./lib/mock-service";
import { ImportRequestSchema, JobStateSchema } from "./lib/types";

const result = buildMockResult();

describe("mock data", () => {
  it("is valid against domain schemas and uses hypothesis wording", () => {
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      if (f.status === "detected") expect(f.explanation).toMatch(/consistent with|may suggest|may not|weak evidence/i);
    }
  });
});

describe("mock service", () => {
  it("progresses from running to done, and reports unknown ids", async () => {
    let t = 0;
    const svc = createMockService(() => t);
    const { id } = await svc.start({ source: "lichess", username: "magnus" });
    expect((await svc.get(id))?.state).toBe("running");
    t = 10_000;
    expect(JobStateSchema.parse(await svc.get(id)).state).toBe("done");
    expect(await svc.get("nope")).toBeUndefined();
  });
  it("supports error and empty demo users", async () => {
    let t = 0;
    const svc = createMockService(() => t);
    const e = await svc.start({ source: "lichess", username: "error-demo" });
    const m = await svc.start({ source: "chesscom", username: "empty-demo" });
    t = 10_000;
    expect((await svc.get(e.id))?.state).toBe("error");
    const empty = await svc.get(m.id);
    expect(empty?.state === "done" && empty.result.gamesAnalyzed).toBe(0);
  });
});

describe("import request validation", () => {
  it("rejects bad usernames and short PGN", () => {
    expect(ImportRequestSchema.safeParse({ source: "lichess", username: "a b" }).success).toBe(false);
    expect(typeof buildRequest("pgn", "1.")).toBe("string");
    expect(typeof buildRequest("lichess", "")).toBe("string");
  });
  it("accepts valid input", () => {
    expect(buildRequest("chesscom", " hikaru ")).toEqual({ source: "chesscom", username: "hikaru" });
  });
});

describe("components", () => {
  it("StateMessage uses alert for errors and status otherwise", () => {
    expect(renderToStaticMarkup(<StateMessage kind="error" title="Boom" />)).toContain('role="alert"');
    const loading = renderToStaticMarkup(<StateMessage kind="loading" title="Wait" />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
  });
  it("FindingCard shows confidence and evidence for detected findings", () => {
    const f = result.findings.find((x) => x.status === "detected");
    if (!f) throw new Error("fixture");
    const html = renderToStaticMarkup(<FindingCard finding={f} />);
    expect(html).toContain("Confidence in this hypothesis");
    expect(html).toContain("Evidence (3 positions)");
    expect(html).not.toMatch(/\b(anxious|angry|frustrated|emotion|tilted)\b/i);
  });
  it("FindingCard shows the reason for insufficient data", () => {
    const f = result.findings.find((x) => x.status === "insufficient_data");
    if (!f || f.status !== "insufficient_data") throw new Error("fixture");
    expect(renderToStaticMarkup(<FindingCard finding={f} />)).toContain(f.reason);
  });
  it("FindingsList renders the empty state when nothing is detected", () => {
    const html = renderToStaticMarkup(<FindingsList result={{ ...result, findings: [] }} />);
    expect(html).toContain("No recurring patterns found");
  });
  it("PlanContent lists drills and themes, and has an empty state", () => {
    expect(renderToStaticMarkup(<PlanContent plan={result.plan} />)).toContain("Puzzle themes to practise");
    const empty = { ...result.plan, chessDrills: [], softSkillDrills: [], puzzleThemes: [] };
    expect(renderToStaticMarkup(<PlanContent plan={empty} />)).toContain("No plan yet");
  });
});
