# ADR 0004: Puzzle source
Status: proposed
Lichess puzzle database (CC0) downloaded by `npm run setup:puzzles` and indexed into SQLite; never committed. Open question: the file is distributed compressed with zstd. Whether to use a Node zstd library or require a system `zstd` binary is undecided. Verify before implementing.
