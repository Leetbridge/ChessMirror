import type Database from "better-sqlite3";
import type { z } from "zod";
import { AnalyzedGameSchema, FindingSchema, GameSchema, PlanSchema } from "../domain";
import type { AnalyzedGame, Finding, Game, Plan } from "../domain";
import { openDatabase } from "./db";
import { REPOSITORY_MIGRATIONS } from "./migrations";
import type { Repository } from "./index";

function parse<T>(schema: z.ZodType<T>, json: string): T {
  return schema.parse(JSON.parse(json));
}

interface Row {
  json: string;
}

/**
 * SQLite implementation of Repository (ADR 0003). Documents are stored as JSON, validated with zod
 * on write and on read. All SQL is parameterized. Saves are upserts keyed by the domain id.
 */
export function createSqliteRepository(databasePath: string): Repository {
  const db: Database.Database = openDatabase(databasePath, REPOSITORY_MIGRATIONS);

  const upsertGame = db.prepare(
    "INSERT INTO games (id, played_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET played_at = excluded.played_at, json = excluded.json",
  );
  const selectGame = db.prepare("SELECT json FROM games WHERE id = ?");
  const selectGames = db.prepare("SELECT json FROM games ORDER BY played_at DESC, id");
  const upsertAnalyzed = db.prepare(
    "INSERT INTO analyzed_games (game_id, json) VALUES (?, ?) ON CONFLICT(game_id) DO UPDATE SET json = excluded.json",
  );
  const selectAnalyzed = db.prepare("SELECT json FROM analyzed_games WHERE game_id = ?");
  const selectAnalyzedAll = db.prepare("SELECT json FROM analyzed_games ORDER BY game_id");
  const upsertFinding = db.prepare(
    "INSERT INTO findings (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
  );
  const selectFindings = db.prepare("SELECT json FROM findings ORDER BY rowid");
  const upsertPlan = db.prepare(
    "INSERT INTO plans (id, created_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, json = excluded.json",
  );
  const selectLatestPlan = db.prepare("SELECT json FROM plans ORDER BY created_at DESC, rowid DESC LIMIT 1");

  return {
    async saveGames(games: Game[]) {
      const valid = games.map((g) => GameSchema.parse(g));
      db.transaction(() => {
        for (const g of valid) upsertGame.run(g.id, g.playedAt, JSON.stringify(g));
      })();
    },
    async getGame(id: string) {
      const row = selectGame.get(id) as Row | undefined;
      return row ? parse(GameSchema, row.json) : undefined;
    },
    async listGames() {
      return (selectGames.all() as Row[]).map((r) => parse(GameSchema, r.json));
    },

    async saveAnalyzedGame(game: AnalyzedGame) {
      const g = AnalyzedGameSchema.parse(game);
      upsertAnalyzed.run(g.game.id, JSON.stringify(g));
    },
    async getAnalyzedGame(gameId: string) {
      const row = selectAnalyzed.get(gameId) as Row | undefined;
      return row ? parse(AnalyzedGameSchema, row.json) : undefined;
    },
    async listAnalyzedGames() {
      return (selectAnalyzedAll.all() as Row[]).map((r) => parse(AnalyzedGameSchema, r.json));
    },

    async saveFindings(findings: Finding[]) {
      const valid = findings.map((f) => FindingSchema.parse(f));
      db.transaction(() => {
        for (const f of valid) upsertFinding.run(f.id, JSON.stringify(f));
      })();
    },
    async listFindings() {
      return (selectFindings.all() as Row[]).map((r) => parse(FindingSchema, r.json));
    },

    async savePlan(plan: Plan) {
      const p = PlanSchema.parse(plan);
      upsertPlan.run(p.id, p.createdAt, JSON.stringify(p));
    },
    async getLatestPlan() {
      const row = selectLatestPlan.get() as Row | undefined;
      return row ? parse(PlanSchema, row.json) : undefined;
    },

    async close() {
      db.close();
    },
  };
}
