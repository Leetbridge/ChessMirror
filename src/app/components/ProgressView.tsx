"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useJob } from "../lib/useJob";
import { ProgressBar } from "./JobGate";
import { StateMessage } from "./StateMessage";

export function ProgressView({ id }: { id: string }) {
  const router = useRouter();
  const job = useJob(id);

  useEffect(() => {
    if (job.state === "done") router.replace(`/dashboard/${encodeURIComponent(id)}`);
  }, [job.state, id, router]);

  if (job.state === "loading") return <StateMessage kind="loading" title="Starting analysis" />;
  if (job.state === "failed" || job.state === "error") {
    return (
      <StateMessage kind="error" title="The analysis did not finish">
        <p>{job.message}</p>
        <Link href="/">Try again</Link>
      </StateMessage>
    );
  }
  if (job.state === "done") {
    return (
      <StateMessage kind="loading" title="Analysis complete">
        <p>
          Opening your <Link href={`/dashboard/${encodeURIComponent(id)}`}>dashboard</Link>.
        </p>
      </StateMessage>
    );
  }
  return (
    <StateMessage kind="loading" title="Analyzing your games">
      <ProgressBar progress={job.progress} />
    </StateMessage>
  );
}
