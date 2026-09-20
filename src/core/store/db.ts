import Database from "better-sqlite3";

/**
 * Opens a SQLite file (or ":memory:"), enables foreign keys and applies pending migrations.
 * `path` is always passed in by the caller; core never reads process.env.
 */
export function openDatabase(
  path: string,
  migrations: readonly string[],
  opts: { readonly?: boolean } = {},
): Database.Database {
  const db = new Database(path, opts.readonly ? { readonly: true, fileMustExist: true } : {});
  if (opts.readonly) return db;
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const current = Number(db.pragma("user_version", { simple: true }));
  if (current > migrations.length) {
    db.close();
    throw new Error(`Database schema version ${current} is newer than this build supports (${migrations.length}).`);
  }
  for (let v = current; v < migrations.length; v++) {
    const sql = migrations[v] as string;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
