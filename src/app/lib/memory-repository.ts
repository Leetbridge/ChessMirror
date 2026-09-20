import type { AnalyzedGame, Finding, Game, Plan } from "../../core/domain";
import type { Repository } from "../../core/store";

/**
 * Process-local Repository. Used until the SQLite implementation is wired in;
 * swap by passing another Repository to the pipeline.
 */
export function createMemoryRepository(): Repository {
  const games = new Map<string, Game>();
  const analyzed = new Map<string, AnalyzedGame>();
  let findings: Finding[] = [];
  let plan: Plan | undefined;
  return {
    async saveGames(gs) {
      for (const g of gs) games.set(g.id, g);
    },
    async getGame(id) {
      return games.get(id);
    },
    async listGames() {
      return [...games.values()];
    },
    async saveAnalyzedGame(g) {
      analyzed.set(g.game.id, g);
    },
    async getAnalyzedGame(id) {
      return analyzed.get(id);
    },
    async listAnalyzedGames() {
      return [...analyzed.values()];
    },
    async saveFindings(fs) {
      findings = [...fs];
    },
    async listFindings() {
      return [...findings];
    },
    async savePlan(p) {
      plan = p;
    },
    async getLatestPlan() {
      return plan;
    },
    async close() {},
  };
}
