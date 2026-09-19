"use client";
import type { Drill, Plan } from "../../core/domain";
import type { AnalysisResult } from "../lib/types";
import { JobGate } from "./JobGate";
import { StateMessage } from "./StateMessage";

function DrillList({ title, drills, id }: { title: string; drills: Drill[]; id: string }) {
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
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlanContent({ plan }: { plan: Plan }) {
  if (plan.chessDrills.length === 0 && plan.softSkillDrills.length === 0 && plan.puzzleThemes.length === 0) {
    return (
      <StateMessage kind="empty" title="No plan yet">
        <p>A plan is built from detected patterns. None were found in this sample.</p>
      </StateMessage>
    );
  }
  return (
    <>
      <DrillList title="Chess drills" drills={plan.chessDrills} id="chess-h" />
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
  return <JobGate id={id}>{(r: AnalysisResult) => <PlanContent plan={r.plan} />}</JobGate>;
}
