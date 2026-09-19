"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useJob } from "../lib/useJob";
import type { AnalysisResult, Progress } from "../lib/types";
import { StateMessage } from "./StateMessage";

export const STAGE_LABELS: Record<Progress["stage"], string> = {
  import: "Importing games",
  engine: "Analyzing positions with the engine",
  habits: "Looking for recurring patterns",
  plan: "Building your plan",
};

export function ProgressBar({ progress }: { progress: Progress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div>
      <p>
        {STAGE_LABELS[progress.stage]} ({progress.done} of {progress.total} games)
      </p>
      <progress value={progress.done} max={progress.total || 1} aria-label="Analysis progress">
        {pct}%
      </progress>
    </div>
  );
}

const NewAnalysis = () => <Link href="/">Start a new analysis</Link>;

/** Handles loading, error and progress states; renders children once the analysis is done. */
export function JobGate({
  id,
  showProgress = false,
  children,
}: {
  id: string;
  showProgress?: boolean;
  children: (result: AnalysisResult) => ReactNode;
}) {
  const job = useJob(id);
  switch (job.state) {
    case "loading":
      return <StateMessage kind="loading" title="Loading analysis" />;
    case "failed":
      return (
        <StateMessage kind="error" title="Could not load this analysis">
          <p>{job.message}</p>
          <NewAnalysis />
        </StateMessage>
      );
    case "error":
      return (
        <StateMessage kind="error" title="The analysis did not finish">
          <p>{job.message}</p>
          <NewAnalysis />
        </StateMessage>
      );
    case "running":
      return (
        <StateMessage kind="loading" title="Analyzing your games">
          {showProgress ? <ProgressBar progress={job.progress} /> : <p>Still working. This page updates automatically.</p>}
        </StateMessage>
      );
    case "done":
      if (job.result.gamesAnalyzed === 0) {
        return (
          <StateMessage kind="empty" title="No games found">
            <p>We could not find any games to analyze. Check the username or paste a PGN.</p>
            <NewAnalysis />
          </StateMessage>
        );
      }
      return <>{children(job.result)}</>;
  }
}
