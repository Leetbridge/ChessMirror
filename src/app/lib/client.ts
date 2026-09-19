import { JobStateSchema, StartResponseSchema, type ImportRequest, type JobState } from "./types";

export async function startAnalysis(request: ImportRequest): Promise<string> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String((data as { error: unknown }).error) : "";
    throw new Error(msg || "Could not start the analysis.");
  }
  return StartResponseSchema.parse(data).id;
}

export async function fetchJob(id: string): Promise<JobState> {
  const res = await fetch(`/api/analyze/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) throw new Error("This analysis was not found. It may have expired; start a new one.");
  if (!res.ok) throw new Error("Could not load the analysis.");
  return JobStateSchema.parse(await res.json());
}
