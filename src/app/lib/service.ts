// NOTE: chessmirror is a single-user local tool. The job store is in memory and the
// API has no authentication or rate limiting. Do not expose it publicly without adding
// both (size and concurrency limits exist in the analyze route and the service, but
// they are not a substitute).
import { createMockService } from "./mock-service";
import { createRealService } from "./real-service";
import type { AnalysisService } from "./types";

// Real pipeline by default (import -> engine -> classify -> habits -> plan -> coach).
// Set CHESSMIRROR_MOCK=1 to use the canned demo service instead.
const globalForService = globalThis as unknown as { __chessmirrorService?: AnalysisService };

export function getService(): AnalysisService {
  globalForService.__chessmirrorService ??= process.env["CHESSMIRROR_MOCK"] === "1" ? createMockService() : createRealService();
  return globalForService.__chessmirrorService;
}
