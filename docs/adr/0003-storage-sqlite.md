# ADR 0003: Local-first storage with SQLite
Status: accepted
better-sqlite3 behind a `Repository` interface. No accounts. Supabase may implement the same interface later, off by default.

## Native build (verified)
On this machine (macOS, Node 20.19.0) `npm install better-sqlite3@12.11.1` installs and loads (SQLite 3.53.2); I did not check whether it used a prebuilt binary or compiled from source.

## Version pin
better-sqlite3 13.x declares `engines.node >=22`, while the project supports Node 20 (`package.json` engines `>=20`). We depend on `^12.11.1`, whose declared engines include 20.x. Moving to 13 requires raising the Node floor and a new ADR.

## Design
- `createSqliteRepository(databasePath)`: documents stored as JSON in tables keyed by domain id, validated with zod on write and read. Upserts, parameterized queries only.
- Migrations: ordered SQL strings, version tracked in `PRAGMA user_version`, each applied in a transaction. A database newer than the build is refused.
- The path is passed in by the caller (`DATABASE_PATH` is read in `src/app` or scripts, never inside `src/core`).
- Puzzles live in a separate file (ADR 0004) behind `PuzzleStore`.
- The `Repository` interface stays async although better-sqlite3 is synchronous, so a remote implementation fits the same seam.
