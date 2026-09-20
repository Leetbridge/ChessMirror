"use client";
import type { Drill, Plan } from "../../core/domain";
import type { AnalysisResult, PuzzleRef } from "../lib/types";
import { JobGate } from "./JobGate";
import { StateMessage } from "./StateMessage";

export const PUZZLE_URL = (id: string) => `https://lichess.org/training/${encodeURIComponent(id)}`;

function PuzzleList({ puzzles }: { puzzles: PuzzleRef[] }) {
  return (
    <details>
      <summary>{puzzles.length} puzzles to try</summary>
      <ul className="puzzles">
        {puzzles.map((p) => (
          <li key={p.id}>
            <a href={PUZZLE_URL(p.id)} target="_blank" rel="noopener noreferrer">
              Puzzle {p.id}
            </a>{" "}
            <span>rating {p.rating}</span>{" "}
            {p.themes.map((t) => (
              <span className="chip" key={t}>
                {t}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DrillList({
  title,
  drills,
  id,
  puzzles,
}: {
  title: string;
  drills: Drill[];
  id: string;
  puzzles?: Record<string, PuzzleRef[]> | undefined;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul className="drills">
        {drills.map((d) => (
          <li key={d.id} className="card">
            <h3>{d.title}</h3>
            <p>{d.description}</p>
            {d.puzzleThemes && d.puzzleThemes.length > 0 && (
              <p className="themes">
                <span className="sr-only">Puzzle themes: </span>
                {d.puzzleThemes.map((t) => (
                  <span className="chip" key={t}>
                    {t}
                  </span>
                ))}
              </p>
            )}
            {puzzles?.[d.id] && puzzles[d.id]!.length > 0 && <PuzzleList puzzles={puzzles[d.id]!} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlanContent({
  plan,
  puzzles,
  puzzlesAvailable,
}: {
  plan: Plan;
  puzzles?: Record<string, PuzzleRef[]> | undefined;
  /** false = puzzle database missing; undefined = unknown (e.g. demo data), nothing is said. */
  puzzlesAvailable?: boolean | undefined;
}) {
  if (plan.chessDrills.length === 0 && plan.softSkillDrills.length === 0 && plan.puzzleThemes.length === 0) {
    return (
      <StateMessage kind="empty" title="No plan yet">
        <p>A plan is built from detected patterns. None were found in this sample.</p>
      </StateMessage>
    );
  }
  return (
    <>
      <DrillList title="Chess drills" drills={plan.chessDrills} id="chess-h" puzzles={puzzles} />
      {puzzlesAvailable === false && plan.chessDrills.length > 0 && (
        <p className="lede">
          Real puzzles for these drills are not set up yet. Run <code>npm run setup:puzzles</code> to download the Lichess
          puzzle database, then run a new analysis.
        </p>
      )}
      <DrillList title="Habit drills" drills={plan.softSkillDrills} id="soft-h" />
      <section aria-labelledby="puz-h">
        <h2 id="puz-h">Puzzle themes to practise</h2>
        <p className="themes">
          {plan.puzzleThemes.map((t) => (
            <span className="chip" key={t}>
              {t}
            </span>
          ))}
        </p>
      </section>
    </>
  );
}

export function PlanView({ id }: { id: string }) {
  return <JobGate id={id}>{(r: AnalysisResult) => <PlanContent plan={r.plan} puzzles={r.drillPuzzles} puzzlesAvailable={r.puzzlesAvailable} />}</JobGate>;
}
