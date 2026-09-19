import type { Drill } from "../domain";

/** Soft skill each detector maps to (ARCHITECTURE.md, "Habit detectors"). */
export const SOFT_SKILLS = {
  "time-trouble-blunders": "Time management under pressure",
  "tilt-after-loss": "Resilience",
  "thrown-wins": "Patience and converting",
  "fast-critical-moves": "Decision-making",
  "no-resignation": "Acceptance",
} as const;

export type DetectorId = keyof typeof SOFT_SKILLS;

export interface DetectorText {
  softSkill: string;
  chessDrill: Drill;
  softSkillDrill: Drill;
}

/** Static, user-facing text. Hypothesis wording only; scanned by text.test.ts. */
export const TEXT: Record<DetectorId, DetectorText> = {
  "time-trouble-blunders": {
    softSkill: SOFT_SKILLS["time-trouble-blunders"],
    chessDrill: {
      id: "drill-tt-chess",
      kind: "chess",
      title: "Quick tactics with a clock",
      description:
        "Solve 10 tactics puzzles with a 20-second limit each, so that finding safe moves quickly becomes routine.",
      puzzleThemes: ["hangingPiece", "mateIn1", "mateIn2"],
    },
    softSkillDrill: {
      id: "drill-tt-soft",
      kind: "soft_skill",
      title: "Checkpoint budget",
      description:
        "Before each game, pick two clock checkpoints (for example move 15 and move 30) and note your time at each. If you are behind, simplify the position.",
    },
  },
  "tilt-after-loss": {
    softSkill: SOFT_SKILLS["tilt-after-loss"],
    chessDrill: {
      id: "drill-tilt-chess",
      kind: "chess",
      title: "Blunder-check puzzles",
      description:
        "Solve 10 'does this move hang something?' puzzles to rebuild the habit of a safety check before every move.",
      puzzleThemes: ["hangingPiece", "defensiveMove"],
    },
    softSkillDrill: {
      id: "drill-tilt-soft",
      kind: "soft_skill",
      title: "Five-minute reset after a loss",
      description:
        "After a loss, step away for five minutes and write one sentence about what you would change before you queue the next game.",
    },
  },
  "thrown-wins": {
    softSkill: SOFT_SKILLS["thrown-wins"],
    chessDrill: {
      id: "drill-throw-chess",
      kind: "chess",
      title: "Convert the advantage",
      description:
        "Play out 5 winning positions against the engine or solve advantage puzzles, focusing on trading pieces and removing counterplay.",
      puzzleThemes: ["advantage", "crushing", "endgame"],
    },
    softSkillDrill: {
      id: "drill-throw-soft",
      kind: "soft_skill",
      title: "Ask 'what does my opponent want?'",
      description:
        "When you are clearly better, pause and name the opponent's best counter-chance before every move, and pick the safest way to keep the advantage.",
    },
  },
  "fast-critical-moves": {
    softSkill: SOFT_SKILLS["fast-critical-moves"],
    chessDrill: {
      id: "drill-fast-chess",
      kind: "chess",
      title: "Candidate-move practice",
      description:
        "On 10 puzzles, list at least three candidate moves and the opponent's best reply to each before you play.",
      puzzleThemes: ["middlegame", "short", "equality"],
    },
    softSkillDrill: {
      id: "drill-fast-soft",
      kind: "soft_skill",
      title: "Slow down on captures and checks",
      description:
        "Adopt a rule: whenever the position has a capture, check or threat, take at least 10 seconds to check the opponent's replies before moving.",
    },
  },
  "no-resignation": {
    softSkill: SOFT_SKILLS["no-resignation"],
    chessDrill: {
      id: "drill-resign-chess",
      kind: "chess",
      title: "Defend and swindle",
      description:
        "Practice 10 defensive puzzles, and review one lost game to find the move where the position became clearly lost.",
      puzzleThemes: ["defensiveMove", "equality", "endgame"],
    },
    softSkillDrill: {
      id: "drill-resign-soft",
      kind: "soft_skill",
      title: "Set a stop rule",
      description:
        "Decide in advance: if the engine-style evaluation looks lost for several moves in a row, resign and spend the saved minutes reviewing what went wrong.",
    },
  },
};
