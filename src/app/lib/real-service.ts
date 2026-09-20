import { openPuzzleStore, openRepository, databasePath, puzzlesPath, type ResultStore } from "./storage";
import { findStockfish } from "./stockfish-path";
import { readConfig, runPipeline, toUserMessage, type PipelineDeps } from "./pipeline";
import { JobStateSchema, ServiceBusyError, type AnalysisService, type ImportRequest, type JobState } from "./types";

/** Bounds on the in-memory job store. */
export const JOB_TTL_MS = 60 * 60 * 1000;
export const MAX_JOBS = 50;

export type DepsFactory = () => PipelineDeps;

/** Deps read from process.env at job start, so env changes apply without a restart. */
function withStockfish(config: ReturnType<typeof readConfig>, env: Record<string, string | undefined>) {
  // STOCKFISH_PATH wins; otherwise look on PATH and in common install folders.
  return config.stockfishPath ? config : { ...config, stockfishPath: findStockfish(env) };
}

export function envDeps(env: NodeJS.ProcessEnv = process.env): PipelineDeps {
  const repository = openRepository(databasePath(env));
  const puzzleStore = openPuzzleStore(puzzlesPath(env));
  return {
    config: withStockfish(readConfig(env), env),
    env,
    repository,
    ...(puzzleStore ? { puzzleStore } : {}),
    release: async () => {
      puzzleStore?.close();
      await repository.close();
    },
  };
}

/**
 * Real analysis service: one job at a time, run in the background of the server process.
 * Progress is reported per game; the engine is closed by runPipeline when the job ends.
 */
export function createRealService(
  makeDeps: DepsFactory = envDeps,
  now: () => number = Date.now,
  resultStore: ResultStore | null = null,
): AnalysisService {
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
        let deps: PipelineDeps | undefined;
        try {
          deps = makeDeps();
          const own = deps;
          const { result } = await runPipeline(request, {
            ...own,
            onProgress: (progress) => {
              job.state = { state: "running", progress };
              own.onProgress?.(progress);
            },
          });
          resultStore?.save(id, result);
          job.state = { state: "done", result };
        } catch (e) {
          job.state = { state: "error", message: toUserMessage(e, request.source) };
        } finally {
          try {
            await deps?.release?.();
          } catch {
            /* closing is best effort */
          }
        }
      })();
      return { id };
    },

    async get(id) {
      let job = jobs.get(id);
      if (job && job.state.state !== "running" && now() - job.startedAt > JOB_TTL_MS) {
        jobs.delete(id);
        job = undefined;
      }
      if (job) return JobStateSchema.parse(job.state);
      // Finished results survive a restart or memory expiry; running jobs do not.
      const stored = resultStore?.load(id);
      return stored ? JobStateSchema.parse({ state: "done", result: stored }) : undefined;
    },
  };
}
