import { describe, expect, it } from "vitest";
import { PlanSchema, type Finding } from "../domain";
import { buildPlan, themesForDetector } from "./index";

const drill = (id: string, kind: "chess" | "soft_skill") => ({ id, kind, title: id, description: `do ${id}` });
const findings: Finding[] = [
  {
    id: "f-tilt",
    detector: "tilt-after-loss",
    status: "detected",
    evidence: [{ gameId: "g2", ply: 12 }],
    severity: "medium",
    confidence: 0.6,
    explanation: "consistent with a pattern after defeats",
    chessDrill: drill("d-tilt-chess", "chess"),
    softSkillDrill: drill("d-tilt-soft", "soft_skill"),
  },
  {
    id: "f-time",
    detector: "time-trouble-blunders",
    status: "detected",
    evidence: [{ gameId: "g1", ply: 31 }],
    severity: "high",
    confidence: 0.8,
    explanation: "consistent with time pressure",
    chessDrill: drill("d-time-chess", "chess"),
    softSkillDrill: drill("d-time-soft", "soft_skill"),
  },
  { id: "f-resign", detector: "never-resigns", status: "insufficient_data", reason: "Only 3 games" },
];

describe("buildPlan", () => {
  const plan = buildPlan(findings, { now: "2026-03-05T00:00:00Z" });

  it("produces a schema-valid plan from detected findings only", () => {
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.findingIds).toEqual(["f-time", "f-tilt"]);
    expect(plan.chessDrills.map((d) => d.id)).toEqual(["d-time-chess", "d-tilt-chess"]);
    expect(plan.softSkillDrills).toHaveLength(2);
  });
  it("maps detectors to puzzle themes and merges them into drills", () => {
    expect(plan.chessDrills[0]?.puzzleThemes).toEqual(themesForDetector("time-trouble-blunders"));
    expect(plan.puzzleThemes).toContain("hangingPiece");
    expect(new Set(plan.puzzleThemes).size).toBe(plan.puzzleThemes.length);
  });
  it("is deterministic and pure", () => {
    expect(buildPlan(findings, { now: "2026-03-05T00:00:00Z" })).toEqual(plan);
  });
  it("orders by severity and handles no detected findings", () => {
    const reversed = buildPlan([...findings].reverse(), { now: "2026-03-05T00:00:00Z" });
    expect(reversed.findingIds[0]).toBe("f-time");
    const empty = buildPlan([], { now: "2026-03-05T00:00:00Z" });
    expect(empty.findingIds).toEqual([]);
    expect(empty.puzzleThemes).toEqual([]);
  });
  it("falls back to generic themes for unknown detectors", () => {
    expect(themesForDetector("something-new").length).toBeGreaterThan(0);
  });
});
