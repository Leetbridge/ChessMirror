# ADR 0001: Stack and layout
Status: accepted
Single Next.js + TypeScript app. Framework-free modules in `src/core/*`, boundaries enforced by ESLint. chess.js for rules and PGN. Workspaces can come later if a module needs publishing.

## Scaffold notes (task 1)
- Next.js 16 (App Router), React 19, zod 4, Node 20, npm. TypeScript pinned to 5.9 (`~5.9`); I did not verify TypeScript 7 against Next 16 or typescript-eslint, so it is not used. ESLint pinned to 9 (`^9`); ESLint 10 support in eslint-config-next is unverified.
- Boundaries use `eslint-plugin-boundaries` 7.x (`boundaries/dependencies` with `default: "disallow"` policies, per https://www.jsboundaries.dev/docs/quick-start/). The rules mirror the dependency table in ARCHITECTURE.md and are generated from a single map in `eslint.config.mjs`. `tests/boundaries.test.ts` proves violating imports fail lint. Modules import each other by relative path (no TS path aliases), so no import resolver plugin is needed.
- `src/app` may import any core module (it wires them together). Core modules may not import `src/app`.
- `HabitDetector` is a plain function type `(AnalyzedGame[]) => Finding | null` (defined in `src/core/habits/types.ts`). `Finding` is a discriminated union on `status` (`detected` | `insufficient_data`); `null` means enough data but no pattern found. A `not_detected` variant may replace `null` later.
- Test runner: vitest (config in `vitest.config.mts`).
