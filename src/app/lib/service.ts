// NOTE: chessmirror is a single-user local tool. The job store is in memory and the
// API has no authentication or rate limiting. Do not expose it publicly without adding
// both (size and concurrency limits exist in the analyze route and the service, but
// they are not a substitute).
import { createMockService } from "./mock-service";
import type { AnalysisService } from "./types";

// Single swap point: replace the mock with the real pipeline (import -> engine ->
// classify -> habits -> plan) once the core modules are merged.
const globalForService = globalThis as unknown as { __chessmirrorService?: AnalysisService };

export function getService(): AnalysisService {
  globalForService.__chessmirrorService ??= createMockService();
  return globalForService.__chessmirrorService;
}
