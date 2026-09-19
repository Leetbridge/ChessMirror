import { describe, expect, it } from "vitest";
import type { Finding } from "../domain";
import { detectHabits, TEXT } from "./index";
import {
  fastScenario,
  lostScenario,
  noClockGames,
  thrownScenario,
  tiltScenario,
  timeTroublePositive,
} from "./testing/scenarios";

/** Phrases that claim to know the player's emotional state. */
const BANNED: RegExp[] = [
  /\byou (were|are|felt|feel|got|became|become|seem|seemed) (\w+ )?(angry|mad|frustrated|tilted|upset|anxious|nervous|stressed|emotional|panicked|scared|afraid|annoyed|desperate|impatient)\b/i,
  /\byou (panicked|panic|raged|rage|tilted|tilt|snapped|lost your (cool|temper|composure))\b/i,
  /\byour (anger|frustration|panic|fear|emotions?|mood|tilt)\b/i,
  /\bemotions? (detected|detection)\b/i,
  /\b(detect|detected|detects) (your |an? )?(emotion|anger|frustration|tilt|panic|stress)/i,
  /\b(rage[- ]?quit|angry|furious|frustrated|panicking)\b/i,
];

const HYPOTHESIS = /consistent with|may suggest|could|might/i;

function allFindings(): Finding[] {
  return [
    ...detectHabits(timeTroublePositive()),
    ...detectHabits(tiltScenario({ postBlunders: 2, baselineBlunders: 0 })),
    ...detectHabits(thrownScenario(4, 1)),
    ...detectHabits(fastScenario(1_000)),
    ...detectHabits(lostScenario(10)),
    ...detectHabits(noClockGames()),
  ];
}

function strings(): string[] {
  const out: string[] = [];
  for (const t of Object.values(TEXT)) {
    for (const d of [t.chessDrill, t.softSkillDrill]) out.push(d.title, d.description);
  }
  for (const f of allFindings()) {
    if (f.status === "detected") {
      out.push(f.explanation, f.chessDrill.title, f.chessDrill.description, f.softSkillDrill.title, f.softSkillDrill.description);
      for (const e of f.evidence) if (e.note) out.push(e.note);
    } else out.push(f.reason);
  }
  return out;
}

describe("user-facing wording", () => {
  it("covers all five detectors in the scan", () => {
    const detected = new Set(allFindings().filter((f) => f.status === "detected").map((f) => f.detector));
    expect([...detected].sort()).toEqual(Object.keys(TEXT).sort());
  });

  it("contains no emotion-claim phrasing", () => {
    for (const s of strings()) for (const re of BANNED) expect(s, `"${s}" matches ${re}`).not.toMatch(re);
  });

  it("the banned-phrase list actually catches claims", () => {
    for (const bad of ["You were frustrated after the loss.", "You tilted.", "Your frustration shows.", "Emotion detected", "rage quit"]) {
      expect(BANNED.some((re) => re.test(bad)), bad).toBe(true);
    }
  });

  it("every explanation uses hypothesis wording", () => {
    for (const f of allFindings()) if (f.status === "detected") expect(f.explanation).toMatch(HYPOTHESIS);
  });
});
