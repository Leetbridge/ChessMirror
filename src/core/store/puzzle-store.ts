import type Database from "better-sqlite3";
import type { Puzzle } from "../domain";
import { openDatabase } from "./db";
import { PUZZLE_MIGRATIONS } from "./migrations";

export interface PuzzleQuery {
  /** Puzzles matching ANY of these themes. */
  themes: readonly string[];
  ratingMin?: number;
  ratingMax?: number;
  limit: number;
}

export interface ThemeCount {
  theme: string;
  count: number;
}

/** Storage for the Lichess puzzle subset. Separate file from the user Repository (replaceable, never committed). */
export interface PuzzleStore {
  insertMany(puzzles: readonly Puzzle[]): void;
  find(query: PuzzleQuery): Puzzle[];
  listThemes(): ThemeCount[];
  count(): number;
  close(): void;
}

interface PuzzleRow {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  popularity: number;
  nb_plays: number;
  themes: string;
}

function toPuzzle(r: PuzzleRow): Puzzle {
  return {
    id: r.id,
    fen: r.fen,
    moves: r.moves.split(" "),
    rating: r.rating,
    popularity: r.popularity,
    nbPlays: r.nb_plays,
    themes: r.themes === "" ? [] : r.themes.split(" "),
  };
}

export function createSqlitePuzzleStore(databasePath: string, opts: { readonly?: boolean } = {}): PuzzleStore {
  const db: Database.Database = openDatabase(databasePath, PUZZLE_MIGRATIONS, opts);
  const readonly = opts.readonly === true;
  const insertPuzzle = readonly
    ? undefined
    : db.prepare(
        "INSERT OR REPLACE INTO puzzles (id, fen, moves, rating, popularity, nb_plays, themes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
  const deleteThemes = readonly ? undefined : db.prepare("DELETE FROM puzzle_themes WHERE puzzle_id = ?");
  const insertTheme = readonly ? undefined : db.prepare("INSERT OR IGNORE INTO puzzle_themes (puzzle_id, theme) VALUES (?, ?)");
  const themeCounts = db.prepare(
    "SELECT theme, COUNT(*) AS count FROM puzzle_themes GROUP BY theme ORDER BY count DESC, theme",
  );
  const total = db.prepare("SELECT COUNT(*) AS n FROM puzzles");

  return {
    insertMany(puzzles) {
      if (!insertPuzzle || !deleteThemes || !insertTheme) throw new Error("Puzzle store is read-only.");
      db.transaction(() => {
        for (const p of puzzles) {
          // INSERT OR REPLACE would delete-then-insert the parent row; clear children explicitly first.
          deleteThemes.run(p.id);
          insertPuzzle.run(p.id, p.fen, p.moves.join(" "), p.rating, p.popularity, p.nbPlays, p.themes.join(" "));
          for (const t of p.themes) insertTheme.run(p.id, t);
        }
      })();
    },
    find(q) {
      if (q.themes.length === 0 || q.limit <= 0) return [];
      const marks = q.themes.map(() => "?").join(",");
      const params: (string | number)[] = [...q.themes];
      let sql = `SELECT p.* FROM puzzles p WHERE p.id IN (SELECT puzzle_id FROM puzzle_themes WHERE theme IN (${marks}))`;
      if (q.ratingMin !== undefined) {
        sql += " AND p.rating >= ?";
        params.push(q.ratingMin);
      }
      if (q.ratingMax !== undefined) {
        sql += " AND p.rating <= ?";
        params.push(q.ratingMax);
      }
      sql += " ORDER BY p.popularity DESC, p.nb_plays DESC, p.id LIMIT ?";
      params.push(q.limit);
      return (db.prepare(sql).all(...params) as PuzzleRow[]).map(toPuzzle);
    },
    listThemes() {
      return (themeCounts.all() as ThemeCount[]).map((r) => ({ theme: r.theme, count: r.count }));
    },
    count() {
      return (total.get() as { n: number }).n;
    },
    close() {
      db.close();
    },
  };
}
