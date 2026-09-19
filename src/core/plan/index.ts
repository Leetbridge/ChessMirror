import { PlanSchema, type Drill, type Finding, type Plan } from "../domain";

/**
 * Lichess puzzle themes per habit. Detector ids are owned by habits/; keys are matched
 * as substrings so exact ids can differ. Theme names are Lichess puzzle themes.
 */
const THEME_MAP: { match: RegExp; themes: string[] }[] = [
  { match: /time|clock/i, themes: ["hangingPiece", "oneMove", "short", "defensiveMove"] },
  { match: /tilt/i, themes: ["hangingPiece", "short", "equality"] },
  { match: /win|throw|convert/i, themes: ["advantage", "crushing", "endgame"] },
  { match: /fast|quick|critical|rush/i, themes: ["fork", "pin", "discoveredAttack", "middlegame"] },
  { match: /resign/i, themes: ["defensiveMove", "equality", "endgame"] },
];

const FALLBACK_THEMES = ["advantage", "short"];

export function themesForDetector(detector: string): string[] {
  return THEME_MAP.find((m) => m.match.test(detector))?.themes ?? FALLBACK_THEMES;
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
