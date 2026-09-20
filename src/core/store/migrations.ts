/** Ordered, append-only. Index + 1 is the schema version stored in `PRAGMA user_version`. */
export const REPOSITORY_MIGRATIONS: readonly string[] = [
  `CREATE TABLE games (
     id TEXT PRIMARY KEY,
     played_at TEXT NOT NULL,
     json TEXT NOT NULL
   );
   CREATE INDEX games_played_at ON games (played_at);
   CREATE TABLE analyzed_games (
     game_id TEXT PRIMARY KEY,
     json TEXT NOT NULL
   );
   CREATE TABLE findings (
     id TEXT PRIMARY KEY,
     json TEXT NOT NULL
   );
   CREATE TABLE plans (
     id TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     json TEXT NOT NULL
   );
   CREATE INDEX plans_created_at ON plans (created_at);`,
];

export const PUZZLE_MIGRATIONS: readonly string[] = [
  `CREATE TABLE puzzles (
     id TEXT PRIMARY KEY,
     fen TEXT NOT NULL,
     moves TEXT NOT NULL,
     rating INTEGER NOT NULL,
     popularity INTEGER NOT NULL,
     nb_plays INTEGER NOT NULL,
     themes TEXT NOT NULL
   );
   CREATE TABLE puzzle_themes (
     puzzle_id TEXT NOT NULL REFERENCES puzzles (id) ON DELETE CASCADE,
     theme TEXT NOT NULL,
     PRIMARY KEY (theme, puzzle_id)
   ) WITHOUT ROWID;
   CREATE INDEX puzzles_rating ON puzzles (rating);`,
];
