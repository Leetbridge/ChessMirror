# Good first issues

Ten starter tickets, checked against the merged v0 code. Check open PRs before starting to avoid duplicate work. Always run `npm run typecheck && npm run lint && npm test` before opening a PR.

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

## 4. Document the habit detectors and their thresholds
- **Description:** Write `docs/detectors.md` explaining each of the five detectors in plain language: what it looks at, the soft skill it maps to, the thresholds in `src/core/habits/constants.ts`, and its known limits (see `docs/KNOWN-LIMITATIONS.md`). Keep the hypothesis wording; do not claim emotion detection.
- **Acceptance criteria:** every constant in `constants.ts` is explained or linked; each detector lists what data it needs before it returns `insufficient_data`; README links to it.
- **Files:** `docs/detectors.md`, `README.md`

## 5. Golden test for a stalemate game
- **Description:** The QA fixtures have no stalemate ending (noted as a gap). Add a synthetic, clearly labelled stalemate PGN, add it to `tests/fixtures/manifest.json`, and assert the classifier and importer handle it (no engine eval for terminal positions).
- **Acceptance criteria:** fixture starts its `[Event]` with "Synthetic"; manifest entry validated by the existing golden test; a classify or import test uses it; all tests pass.
- **Files:** `tests/fixtures/pgn/`, `tests/fixtures/manifest.json`, `tests/fixtures/README.md`, `src/core/classify/classify.test.ts`

## 6. Document all environment variables
- **Description:** `.env.example` lists the variables but the README does not explain them. Add a table covering `STOCKFISH_PATH`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATABASE_PATH`, `PUZZLES_DATABASE_PATH`, `CHESSCOM_USER_AGENT`, `CHESSMIRROR_MOCK`, `CHESSMIRROR_DEPTH` and `CHESSMIRROR_MAX_GAMES` with defaults and valid ranges taken from the code.
- **Acceptance criteria:** defaults and ranges match `src/app/lib/pipeline.ts` and `storage.ts`; a variable missing from `.env.example` is added there; no real secrets.
- **Files:** `README.md`, `.env.example`

## 7. Tilt detector: show time controls in the evidence
- **Description:** `tilt-after-loss` does not normalise for time control (see KNOWN-LIMITATIONS). As a first step, add the time control of each cited game to the evidence `note` so the user can spot mixed bullet and slower games.
- **Acceptance criteria:** evidence notes include the time control when known; no change to detection thresholds; existing tests updated and a new test covers a game with no time control.
- **Files:** `src/core/habits/detectors.ts`, `src/core/habits/detectors.test.ts`

## 8. Add a manual chess.com smoke-test note and script flag
- **Description:** chess.com import has only been tested with recorded fixtures. Document how to run `npm run analyze -- chesscom <user> 5` with a valid `CHESSCOM_USER_AGENT`, and report what happens on an unknown username and on a rate-limit response.
- **Acceptance criteria:** README section with the exact command; the observed behaviour (from a real run) is recorded in the PR; no code change unless a bug is found.
- **Files:** `README.md`, `docs/troubleshooting.md`

## 9. Share the emotion-claim phrase list
- **Description:** The emotion-claim regexes live in `src/core/coach/validate.ts`, and `src/core/habits` has its own wording scan in its tests. Extract one exported constant so both use the same list, without breaking the `habits` to `domain`-only boundary (put it in `domain` if needed).
- **Acceptance criteria:** one source of truth; coach validation and habit tests both use it; ESLint boundaries pass; tests for a claim phrase and a hypothesis-worded sentence.
- **Files:** `src/core/coach/validate.ts`, `src/core/habits/text.test.ts`, `src/core/domain/`

## 10. Add a "clear old results" npm script
- **Description:** Finished results are kept as JSON files with an automatic 200-file / 30-day rule. Add `npm run clean:results` that deletes result files older than N days (default 7, `--days` flag) from the results directory next to `DATABASE_PATH`, printing what it removed.
- **Acceptance criteria:** only touches `*.json` files with UUID names inside the results directory; `--dry-run` flag; tests on a temp directory.
- **Files:** `scripts/clean-results.ts`, `package.json`, `src/app/lib/storage.ts`
