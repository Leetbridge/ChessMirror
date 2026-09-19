"use client";
import type { AnalysisResult } from "../lib/types";
import { JobGate } from "./JobGate";
import { FindingCard } from "./FindingCard";
import { StateMessage } from "./StateMessage";

export function FindingsList({ result }: { result: AnalysisResult }) {
  const detected = result.findings.filter((f) => f.status === "detected");
  const insufficient = result.findings.filter((f) => f.status === "insufficient_data");
  return (
    <>
      <p className="lede">
        Based on {result.gamesAnalyzed} games. These are hypotheses drawn from your move and clock data, not
        conclusions about you. Open the evidence to check them yourself.
      </p>
      {detected.length === 0 ? (
        <StateMessage kind="empty" title="No recurring patterns found">
          <p>Nothing in this sample stood out. More games can make results more reliable.</p>
        </StateMessage>
      ) : (
        <section aria-labelledby="detected-h">
          <h2 id="detected-h">Possible patterns</h2>
          <div className="grid">
            {detected.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </section>
      )}
      {insufficient.length > 0 && (
        <section aria-labelledby="insufficient-h">
          <h2 id="insufficient-h">Not enough data to say</h2>
          <div className="grid">
            {insufficient.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function DashboardView({ id }: { id: string }) {
  return <JobGate id={id}>{(result) => <FindingsList result={result} />}</JobGate>;
}
