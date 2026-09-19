import type { PositionEval } from "../domain";

export interface AnalyzeOptions {
  depth?: number;
  movetimeMs?: number;
}

/** Wraps an external UCI engine (ADR 0002). Evaluations are from White's point of view. */
export interface EngineAnalyzer {
  analyze(fen: string, options?: AnalyzeOptions): Promise<PositionEval>;
  close(): Promise<void>;
}

export { UciEngine, EngineError, EngineNotFoundError, parseInfo, spawnUci } from "./uci";
export type { UciEngineOptions, UciProcess, UciSpawn } from "./uci";
