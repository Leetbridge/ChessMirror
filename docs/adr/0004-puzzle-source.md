# ADR 0004: Puzzle source
Status: accepted

## Decision
- Source: the Lichess puzzle database, CC0, `https://database.lichess.org/lichess_db_puzzle.csv.zst`. Checked on 2026-09-20: 6,100,952 puzzles, last updated 2026-09-10, `Content-Length` 304,429,328 bytes (about 290 MiB compressed).
- CSV columns (from the page): `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate`. `Moves` are UCI. The FEN is the position before the opponent's move; the first move is the opponent's, the solution starts at the second. Themes are space separated. The importer refuses to run if the header differs.
- Downloaded by `npm run setup:puzzles`, indexed into its own SQLite file (`PUZZLES_DATABASE_PATH`, default `./data/puzzles.db`, under the git-ignored `/data/`). Never committed. Separate from the user database so it can be rebuilt or deleted freely.
- Subset, not the whole dump: rating 600 to 2600, top N per theme (default 2000) by popularity then plays, hard cap on total rows (default 150,000), chosen round-robin by rank across themes so no theme starves. Memory is bounded by themes times N.
- Safeguards: `--limit N` (stop after N source rows and abort the download), `--timeout-min` (default 30), `--max-download-mb` (default 600, also checked against `Content-Length`), written to a temp file and renamed only on success, skips if the index exists unless `--force`.

## Decompression (zstd)
Options checked on this machine (Node 20.19.0):
- `node:zlib` zstd: `zlib.createZstdDecompress` is `undefined` on Node 20.19. I believe it exists from Node 22.15 / 23.8 (experimental); not verified here. Used only as a fallback when present.
- System `zstd` binary (v1.5.7 here): streams stdin to stdout, fast, no dependency. Chosen as the default.
- `@mongodb-js/zstd` 7.0.0 is a native addon; I did not evaluate whether it streams. `fzstd` 0.1.1 is pure JS with streaming; not evaluated for speed on about 1 GB of output. Neither was adopted, to avoid another native build or an unproven dependency.

Decision: spawn `zstd -dc` when available, else use `node:zlib` zstd if the runtime has it, else fail with an install hint (`brew install zstd`, `apt install zstd`). Contributors on Node 20 need the binary.

## Tooling
`scripts/setup-puzzles.mjs` imports the TypeScript core (parser, indexer, store) so the logic is unit tested and not duplicated. Node 20 cannot run TypeScript directly, so the script runs through `tsx` (dev dependency, `"setup:puzzles": "tsx scripts/setup-puzzles.mjs"`). This is a small stack addition recorded here.

## Verified
A run with `--limit 300000` downloaded about 15.9 MB compressed, read 300,000 rows in about 8 s, and wrote 66,233 puzzles across 73 themes (26 MB file). The full-dump run (about 290 MiB download, 6.1M rows) was not executed.
