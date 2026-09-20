# Contributing to ChessMirror

Thanks for helping. Please read [ARCHITECTURE.md](ARCHITECTURE.md) first, then the short rules below.

## Setup

Node 20+, then:

```bash
npm ci
cp .env.example .env   # set STOCKFISH_PATH to your own Stockfish install
npm run dev
```

Stockfish is GPL and must stay an external process. Never add its binary or source to the repo.

## Workflow

- One branch per change, small conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Before opening a PR run `npm run typecheck && npm run lint && npm test`. CI runs the same checks.
- Detectors need unit tests with known PGNs and expected outputs, including a negative case.
- Changing a stack choice needs an ADR in `docs/adr/`.

## Code rules (short version)

- TypeScript strict, no `any`. Validate external data (APIs, PGN, LLM output) with zod at the boundary.
- `src/core` is framework-free. Respect the module dependency table in ARCHITECTURE.md; ESLint enforces it.
- The LLM never produces chess moves. Moves come from engine output.
- Never claim to detect emotions. Use hypothesis wording ("consistent with", "may suggest").
- Respect rate limits (Lichess: one request at a time, back off on 429; chess.com: descriptive User-Agent).
- No secrets in git. Add new env vars to `.env.example`.
- Do not invent APIs or library options. If unsure, say so in the PR.
- Stockfish stays an external process (`STOCKFISH_PATH`); never bundle or vendor it (GPL, see ADR 0002).

## Finding work

See [docs/good-first-issues.md](docs/good-first-issues.md) and the [roadmap](ROADMAP.md).

## Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
