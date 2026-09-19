# Good first issues

Ten starter tickets, written against the planned structure in ARCHITECTURE.md and docs/TASKS.md. Some touch files that other v0 tasks are still creating: check the current tree and open PRs before starting, and coordinate to avoid conflicts. Always run `npm run typecheck && npm run lint && npm test` before opening a PR.

## 1. Add a `.nvmrc` and document the Node version
- **Description:** `package.json` requires Node >= 20 but there is no version file for nvm/fnm users.
- **Acceptance criteria:** `.nvmrc` contains `20`; README quickstart mentions it; CI still passes.
- **Files:** `.nvmrc`, `README.md`

## 2. Add a "Stockfish not found" troubleshooting section
- **Description:** New users will hit a missing or wrong `STOCKFISH_PATH`. Document how to find the binary on macOS, Linux and Windows and how to verify it starts.
- **Acceptance criteria:** README (or `docs/troubleshooting.md`) lists the three platforms and a verification step; states that Stockfish is not bundled because of its GPL license; no unverified install commands.
- **Files:** `README.md` or `docs/troubleshooting.md`

## 3. Unit tests for the zod domain schemas
- **Description:** Extend the existing domain tests to cover rejection cases: `PositionEvalSchema` with both or neither of `evalCp` and `mate`, `winPct` outside 0 to 100, `DetectedFindingSchema` with empty `evidence`, `PlanSchema` with a non-ISO `createdAt`.
- **Acceptance criteria:** at least one failing-input test per schema listed; all tests pass.
- **Files:** `src/core/domain/domain.test.ts`

## 4. Centipawn to win% function
- **Description:** Implement a pure function converting centipawns (White's point of view) to the mover's winning chances 0 to 100 for the `classify` module. State the formula and its source in a code comment; if you cannot verify the source, say so in the PR rather than guessing.
- **Acceptance criteria:** pure function with no I/O; returns values in [0, 100]; 0 cp gives 50; monotonic; tests cover symmetry and extreme values; exported from the module index.
- **Files:** `src/core/classify/win-percent.ts`, `src/core/classify/win-percent.test.ts`, `src/core/classify/index.ts`

## 5. Game phase helper
- **Description:** Add a pure function returning `"opening" | "middlegame" | "endgame"` (the `GamePhase` type in domain) for a position or move number. Document the heuristic you choose.
- **Acceptance criteria:** returns a valid `GamePhase`; tests for a start position, a queenless late position and a mid-game position; no imports outside `domain` (ESLint boundaries pass).
- **Files:** `src/core/classify/phase.ts`, `src/core/classify/phase.test.ts`

## 6. Clock extraction from PGN comments
- **Description:** Lichess PGNs carry clock times in move comments in the form `[%clk H:MM:SS]`. Write a parser that extracts seconds per ply and returns "no clock data" when absent. Verify the format against a real exported game first.
- **Acceptance criteria:** parses a fixture with clocks; returns an explicit absent result for a PGN without clocks; malformed values do not throw; tests included.
- **Files:** `src/core/classify/clock.ts`, `src/core/classify/clock.test.ts`, fixture under `tests/fixtures/`

## 7. PGN import with a golden fixture
- **Description:** Using chess.js (see ADR 0001 for the stack), parse a PGN string into `Game[]` validated with `GameSchema`. Reject or skip invalid games with a clear error instead of crashing.
- **Acceptance criteria:** a multi-game PGN yields the right number of games; a truncated PGN yields a typed error; output passes `GameSchema`; no network access.
- **Files:** `src/core/import/pgn.ts`, `src/core/import/pgn.test.ts`, `tests/fixtures/`

## 8. Stockfish path validation with a clear error
- **Description:** Add a function that reads `STOCKFISH_PATH`, checks the file exists and is executable, and throws a descriptive error naming the variable and linking to the README quickstart.
- **Acceptance criteria:** missing env var, nonexistent path and non-executable path each produce distinct error messages; tests use a temp file; the module does not spawn Stockfish.
- **Files:** `src/core/engine/path.ts`, `src/core/engine/path.test.ts`, `src/core/engine/index.ts`

## 9. Hypothesis-wording lint helper
- **Description:** Add a function that flags coach or finding text that states emotions as fact (for example "you were angry" or "you tilted") instead of hypothesis wording ("consistent with", "may suggest"). Keep the phrase list small and in one exported constant.
- **Acceptance criteria:** returns a list of offending phrases; passes on hypothesis-worded text; tests for both; documented in a code comment.
- **Files:** `src/core/coach/wording.ts`, `src/core/coach/wording.test.ts`, `src/core/coach/index.ts`

## 10. Empty and loading states for the dashboard page
- **Description:** `src/app/page.tsx` is a placeholder. Add a simple "no games imported yet" state that explains what to do and that ChessMirror shows hypotheses, not emotion detection.
- **Acceptance criteria:** page renders without errors; copy uses hypothesis wording; no core imports needed; `npm run build` succeeds.
- **Files:** `src/app/page.tsx`
