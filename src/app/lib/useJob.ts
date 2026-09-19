"use client";
import { useEffect, useState } from "react";
import { fetchJob } from "./client";
import type { JobState } from "./types";

export type JobView = { state: "loading" } | { state: "failed"; message: string } | JobState;

/** Polls the job until it is done or failed. */
export function useJob(id: string, intervalMs = 800): JobView {
  const [view, setView] = useState<JobView>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const job = await fetchJob(id);
        if (cancelled) return;
        setView(job);
        if (job.state === "running") timer = setTimeout(tick, intervalMs);
      } catch (e) {
        if (!cancelled) setView({ state: "failed", message: e instanceof Error ? e.message : "Unknown error." });
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, intervalMs]);
  return view;
}
