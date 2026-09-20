// @vitest-environment node
// Components are rendered with react-dom/server, so no DOM environment is needed.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FindingCard, detectorLabel } from "./components/FindingCard";
import { StateMessage } from "./components/StateMessage";
import { PlanContent } from "./components/PlanView";
import { FindingsList } from "./components/DashboardView";
import { buildRequest } from "./components/ImportForm";
import { JOB_TTL_MS, MAX_JOBS, buildMockResult, createMockService } from "./lib/mock-service";
import { ImportRequestSchema, JobStateSchema, MAX_PGN_GAMES, ServiceBusyError } from "./lib/types";

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
    t = 10_000;
    const m = await svc.start({ source: "chesscom", username: "empty-demo" });
    t = 20_000;
    expect((await svc.get(e.id))?.state).toBe("error");
    const empty = await svc.get(m.id);
    expect(empty?.state === "done" && empty.result.gamesAnalyzed).toBe(0);
  });
});

describe("mock service limits", () => {
  const req = { source: "lichess", username: "magnus" } as const;
  it("allows only one running job at a time", async () => {
    const svc = createMockService(() => 0);
    await svc.start(req);
    await expect(svc.start(req)).rejects.toBeInstanceOf(ServiceBusyError);
  });
  it("expires jobs after the TTL", async () => {
    let t = 0;
    const svc = createMockService(() => t);
    const { id } = await svc.start(req);
    t = JOB_TTL_MS + 1;
    expect(await svc.get(id)).toBeUndefined();
  });
  it("caps the number of stored jobs", async () => {
    let t = 0;
    const svc = createMockService(() => t);
    const first = await svc.start(req);
    for (let i = 0; i < MAX_JOBS + 5; i++) {
      t += 10_000;
      await svc.start(req);
    }
    expect(await svc.get(first.id)).toBeUndefined();
  });
  it("rejects a paste with too many games", () => {
    const pgn = '[Event "x"]\n1. e4 *\n\n'.repeat(MAX_PGN_GAMES + 1);
    expect(ImportRequestSchema.safeParse({ source: "pgn", pgn }).success).toBe(false);
  });
  it("uses the real detector ids", () => {
    const ids = result.findings.map((f) => f.detector);
    expect(ids).toEqual(["time-trouble-blunders", "thrown-wins", "fast-critical-moves", "tilt-after-loss", "no-resignation"]);
    for (const id of ids) expect(detectorLabel(id)).not.toBe(id.replace(/-/g, " "));
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
  it("FindingCard shows referenced moves separately and escapes them", () => {
    const f = result.findings.find((x) => x.status === "detected")!;
    const html = renderToStaticMarkup(<FindingCard finding={f} moves={["Nf3", "<b>x</b>"]} />);
    expect(html).toContain("Moves referenced");
    expect(html).toContain("<code>Nf3</code>");
    expect(html).not.toContain("<b>x</b>");
    expect(renderToStaticMarkup(<FindingCard finding={f} />)).not.toContain("Moves referenced");
  });
  it("FindingCard shows the reason for insufficient data", () => {
    const f = result.findings.find((x) => x.status === "insufficient_data");
    if (!f || f.status !== "insufficient_data") throw new Error("fixture");
    expect(renderToStaticMarkup(<FindingCard finding={f} />)).toContain(f.reason);
  });
  it("FindingsList shows the assumed player for pasted PGN and escapes it", () => {
    const html = renderToStaticMarkup(<FindingsList result={{ ...result, assumedPlayer: "<b>Bob</b>" }} />);
    expect(html).toContain("Analyzing games as player");
    expect(html).toContain("&lt;b&gt;Bob&lt;/b&gt;");
    expect(renderToStaticMarkup(<FindingsList result={result} />)).not.toContain("Analyzing games as player");
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
