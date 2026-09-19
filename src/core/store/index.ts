import type { AnalyzedGame, Finding, Game, Plan } from "../domain";

/** Persistence seam. SQLite is the default implementation (ADR 0003). */
export interface Repository {
  saveGames(games: Game[]): Promise<void>;
  getGame(id: string): Promise<Game | undefined>;
  listGames(): Promise<Game[]>;

  saveAnalyzedGame(game: AnalyzedGame): Promise<void>;
  getAnalyzedGame(gameId: string): Promise<AnalyzedGame | undefined>;
  listAnalyzedGames(): Promise<AnalyzedGame[]>;

  saveFindings(findings: Finding[]): Promise<void>;
  listFindings(): Promise<Finding[]>;

  savePlan(plan: Plan): Promise<void>;
  getLatestPlan(): Promise<Plan | undefined>;

  close(): Promise<void>;
}
