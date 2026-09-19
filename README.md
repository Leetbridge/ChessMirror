# ChessMirror

An open-source AI chess coach that shows you your own habits, not just your blunders.

## Why ChessMirror

1. **Open source (Apache-2.0).** The code, the detectors and the prompts are all in the repo. Your data is meant to stay local: no accounts, and a local SQLite file is the planned storage (decided in ADR 0003, not yet implemented).
2. **A soft-skills "mirror".** Chess tools tell you which move was bad. ChessMirror looks across your games for behavioral patterns (for example, blunders when your clock is low, or a run of quick moves after a loss) and shows them to you as *hypotheses*, worded like "this pattern is consistent with...". It does not detect emotions and never claims to. Each finding comes with evidence you can check (game and move references), a chess drill and a soft-skill drill.
3. **A beginner-to-GM curriculum (planned).** The goal is a full learning path from first moves to grandmaster-level preparation. See the [roadmap](ROADMAP.md). None of the curriculum exists yet.

## Status: v0, early and incomplete

This project is at the start of v0. The architecture, domain types, lint boundaries and test setup are in place. Feature work (game import, engine analysis, the five habit detectors, coaching text, dashboard) is in progress and tracked in [docs/TASKS.md](docs/TASKS.md). `npm run setup:puzzles` is currently a stub. Do not expect a working coach yet. Storage in SQLite is planned but not implemented, and the v0 UI currently runs on a mock analysis service until the real pipeline is wired in.

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

1. **Install Stockfish separately** (with your package manager or from the official Stockfish site) and set `STOCKFISH_PATH` in `.env` to the binary. Stockfish is GPL, so ChessMirror does not bundle or vendor it (see [ADR 0002](docs/adr/0002-external-stockfish.md)).
2. `ANTHROPIC_API_KEY` is **optional**. Leave it empty and explanations use a template fallback.
3. Set `CHESSCOM_USER_AGENT` in `.env` to something descriptive with your own contact.
4. Start the dev server:

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
