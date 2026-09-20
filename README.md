# ChessMirror

An open-source AI chess coach that shows you your own habits, not just your blunders.

## Why ChessMirror

1. **Open source (Apache-2.0).** The code, the detectors and the prompts are all in the repo. Your data is meant to stay local: no accounts, and results are stored in a local SQLite file plus JSON result files under `./data/` (ADR 0003).
2. **A soft-skills "mirror".** Chess tools tell you which move was bad. ChessMirror looks across your games for behavioral patterns (for example, blunders when your clock is low, or a run of quick moves after a loss) and shows them to you as *hypotheses*, worded like "this pattern is consistent with...". It does not detect emotions and never claims to. Each finding comes with evidence you can check (game and move references), a chess drill and a soft-skill drill.
3. **A beginner-to-GM curriculum (planned).** The goal is a full learning path from first moves to grandmaster-level preparation. See the [roadmap](ROADMAP.md). None of the curriculum exists yet.

## Status: v0, early and incomplete

v0 works end to end from the command line and the local web UI: import (Lichess, chess.com, pasted PGN), Stockfish analysis, five habit detectors, a personal plan with puzzles by theme, and coaching text (templated, or LLM-written when `ANTHROPIC_API_KEY` is set). It is early software: thresholds are uncalibrated and results are hypotheses. See [docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md) for what is not done or uncertain. Set `CHESSMIRROR_MOCK=1` to run the UI on fake data without Stockfish.

**Security note:** ChessMirror is a single-user local tool. Do not expose it to the public internet without adding authentication and rate limiting first.

Design principles:
- Engines and databases produce every chess fact. The LLM only explains structured findings and never produces moves on its own.
- If there is too little data (few games, no clock info), ChessMirror says "insufficient data" instead of guessing.

## Quickstart

Requirements: Node 20 or newer, and a Stockfish binary.

```bash
git clone <this repository>
cd chessmirror
npm ci
cp .env.example .env
```

1. **Install Stockfish separately** (it is only needed for real analysis, not for tests or `CHESSMIRROR_MOCK=1`). For example `brew install stockfish` on macOS or `sudo apt install stockfish` on Debian/Ubuntu; on Windows download it from the official Stockfish site. ChessMirror finds it on your `PATH` or in common install folders automatically; set `STOCKFISH_PATH` in `.env` only if it lives somewhere else (an explicit value always wins). Stockfish is GPL, so ChessMirror does not bundle or vendor it (see [ADR 0002](docs/adr/0002-external-stockfish.md)).
   Run `npm run doctor` to check your Node version, Stockfish, `zstd` and optional pieces, with install hints for anything missing.
2. `ANTHROPIC_API_KEY` is **optional**. Leave it empty and explanations use a template fallback.
3. Set `CHESSCOM_USER_AGENT` in `.env` to something descriptive with your own contact.
4. **Optional, for puzzle drills:** `npm run setup:puzzles` downloads the Lichess puzzle database (about 290 MiB) and indexes a subset locally. It needs the system `zstd` binary (`brew install zstd` or `apt install zstd`) on Node 20; newer Node versions with built-in zstd support also work. Use `-- --limit 300000` for a quick sample. `better-sqlite3` is a native module: `npm ci` downloads a prebuilt binary, or compiles it with node-gyp if none matches (then a C++ toolchain and Python are needed). See [ADR 0004](docs/adr/0004-puzzle-source.md).
5. Start the dev server:

```bash
npm run dev
```

Other commands: `npm run typecheck`, `npm run lint`, `npm test`.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data flow, module boundaries and detectors, and [docs/adr/](docs/adr/) for decisions.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Looking for a starting point? See [docs/good-first-issues.md](docs/good-first-issues.md).

## License

[Apache-2.0](LICENSE). Stockfish is a separate GPL project and is not part of this repository.

Puzzles come from the [Lichess puzzle database](https://database.lichess.org/#puzzles), released under CC0. Attribution is not required; thank you, Lichess.
