import type { Finding } from "../../core/domain";

export const DETECTOR_LABELS: Record<string, string> = {
  "time-trouble-blunders": "Mistakes under time pressure",
  "tilt-after-loss": "Play after a loss",
  "throwing-away-winning-positions": "Winning positions not converted",
  "too-fast-critical-moves": "Fast moves in critical positions",
  "never-resigning": "Continuing lost games",
};

export function detectorLabel(detector: string): string {
  return DETECTOR_LABELS[detector] ?? detector.replace(/-/g, " ");
}

export function confidenceLabel(c: number): string {
  if (c >= 0.7) return "Stronger evidence";
  if (c >= 0.4) return "Moderate evidence";
  return "Weak evidence";
}

export function FindingCard({ finding }: { finding: Finding }) {
  const title = detectorLabel(finding.detector);
  if (finding.status === "insufficient_data") {
    return (
      <article className="card card-muted" aria-labelledby={`${finding.id}-t`}>
        <h3 id={`${finding.id}-t`}>{title}</h3>
        <p className="badge">Not enough data</p>
        <p>{finding.reason}</p>
      </article>
    );
  }
  const pct = Math.round(finding.confidence * 100);
  return (
    <article className="card" aria-labelledby={`${finding.id}-t`}>
      <header className="card-head">
        <h3 id={`${finding.id}-t`}>{title}</h3>
        <span className={`badge sev-${finding.severity}`}>Impact: {finding.severity}</span>
      </header>
      <p className="hypothesis">{finding.explanation}</p>
      <div className="confidence">
        <label htmlFor={`${finding.id}-c`}>
          Confidence in this hypothesis: {pct}% ({confidenceLabel(finding.confidence)})
        </label>
        <meter id={`${finding.id}-c`} min={0} max={1} value={finding.confidence}>
          {pct}%
        </meter>
      </div>
      <details>
        <summary>
          Evidence ({finding.evidence.length} {finding.evidence.length === 1 ? "position" : "positions"})
        </summary>
        <ul className="evidence">
          {finding.evidence.map((e) => (
            <li key={`${e.gameId}-${e.ply}`}>
              <code>{e.gameId}</code>, move {Math.ceil(e.ply / 2)} (ply {e.ply}){e.note ? `: ${e.note}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
