import { readConfig, runPipeline, toUserMessage, type PipelineDeps } from "./pipeline";
import { JobStateSchema, ServiceBusyError, type AnalysisService, type ImportRequest, type JobState } from "./types";

/** Bounds on the in-memory job store. */
export const JOB_TTL_MS = 60 * 60 * 1000;
export const MAX_JOBS = 50;

export type DepsFactory = () => PipelineDeps;

/** Deps read from process.env at job start, so env changes apply without a restart. */
export function envDeps(env: NodeJS.ProcessEnv = process.env): PipelineDeps {
  return { config: readConfig(env), env };
}

/**
 * Real analysis service: one job at a time, run in the background of the server process.
 * Progress is reported per game; the engine is closed by runPipeline when the job ends.
 */
export function createRealService(makeDeps: DepsFactory = envDeps, now: () => number = Date.now): AnalysisService {
  const jobs = new Map<string, { startedAt: number; state: JobState }>();

  const sweep = () => {
    const t = now();
    for (const [id, job] of jobs) if (job.state.state !== "running" && t - job.startedAt > JOB_TTL_MS) jobs.delete(id);
    for (const [id, job] of jobs) {
      if (jobs.size < MAX_JOBS) break;
      if (job.state.state !== "running") jobs.delete(id); // oldest first (Map insertion order)
    }
  };

  return {
    async start(request: ImportRequest) {
      sweep();
      for (const job of jobs.values()) if (job.state.state === "running") throw new ServiceBusyError();
      const id = crypto.randomUUID();
      const job = {
        startedAt: now(),
        state: { state: "running", progress: { stage: "import", done: 0, total: 0 } } as JobState,
      };
      jobs.set(id, job);

      void (async () => {
        try {
          const deps = makeDeps();
          const { result } = await runPipeline(request, {
            ...deps,
            onProgress: (progress) => {
              job.state = { state: "running", progress };
              deps.onProgress?.(progress);
            },
          });
          job.state = { state: "done", result };
        } catch (e) {
          job.state = { state: "error", message: toUserMessage(e, request.source) };
        }
      })();
      return { id };
    },

    async get(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      if (job.state.state !== "running" && now() - job.startedAt > JOB_TTL_MS) {
        jobs.delete(id);
        return undefined;
      }
      return JobStateSchema.parse(job.state);
    },
  };
}
