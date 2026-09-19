import { createMockService } from "./mock-service";
import type { AnalysisService } from "./types";

// Single swap point: replace the mock with the real pipeline (import -> engine ->
// classify -> habits -> plan) once the core modules are merged.
const globalForService = globalThis as unknown as { __chessmirrorService?: AnalysisService };

export function getService(): AnalysisService {
  globalForService.__chessmirrorService ??= createMockService();
  return globalForService.__chessmirrorService;
}
