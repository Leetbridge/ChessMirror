import { PlanSchema, type Drill, type Finding, type Plan } from "../domain";

/**
 * Lichess puzzle themes per detector, keyed by exact detector id (owned by habits/).
 * Unknown ids get the generic fallback.
 */
const THEME_MAP: Readonly<Record<string, string[]>> = {
  "time-trouble-blunders": ["hangingPiece", "oneMove", "short", "defensiveMove"],
  "tilt-after-loss": ["hangingPiece", "short", "equality"],
  "thrown-wins": ["advantage", "crushing", "endgame"],
  "fast-critical-moves": ["fork", "pin", "discoveredAttack", "middlegame"],
  "no-resignation": ["defensiveMove", "equality", "endgame"],
};

const FALLBACK_THEMES = ["advantage", "short"];

export function themesForDetector(detector: string): string[] {
  return THEME_MAP[detector] ?? FALLBACK_THEMES;
}

export interface BuildPlanOptions {
  /** ISO 8601 date-time. Injected so the function stays pure. */
  now: string;
  /** Defaults to a deterministic id derived from the finding ids. */
  id?: string;
}

function dedupeDrills(drills: Drill[]): Drill[] {
  return [...new Map(drills.map((d) => [d.id, d])).values()];
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Severity then confidence, highest first, so the most important habit leads the plan. */
const SEV: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Findings to Plan. Pure. Insufficient-data findings contribute nothing.
 * Chess drills are enriched with the puzzle themes mapped from their detector.
 */
export function buildPlan(findings: Finding[], opts: BuildPlanOptions): Plan {
  const detected = findings
    .flatMap((f) => (f.status === "detected" ? [f] : []))
    .sort((a, b) => (SEV[b.severity] ?? 0) - (SEV[a.severity] ?? 0) || b.confidence - a.confidence);

  const chessDrills = dedupeDrills(
    detected.map((f) => ({
      ...f.chessDrill,
      puzzleThemes: unique([...(f.chessDrill.puzzleThemes ?? []), ...themesForDetector(f.detector)]),
    })),
  );
  const softSkillDrills = dedupeDrills(detected.map((f) => f.softSkillDrill));
  const puzzleThemes = unique(chessDrills.flatMap((d) => d.puzzleThemes ?? []));
  const findingIds = detected.map((f) => f.id);

  return PlanSchema.parse({
    id: opts.id ?? `plan:${[...findingIds].sort().join("+") || "empty"}`,
    createdAt: opts.now,
    findingIds,
    chessDrills,
    softSkillDrills,
    puzzleThemes,
  });
}
