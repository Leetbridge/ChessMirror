# Known limitations (v0)

Honest list of what is not done or uncertain.

## Not done
- v1 to v4: courses, repertoire builder, endgame trainer, voice coach and mirror profile.
- Curriculum beyond a per-finding plan (chess drill, soft-skill drill, puzzles by theme).
- Puzzle board rendering; puzzles link out to Lichess.
- Auth, rate limiting per user, streaming body-size cutoff on `POST /api/analyze`. Single-user local tool only: do not expose it publicly.
- Result file cleanup beyond a 200-file / 30-day retention rule.
- Supabase option (interface only).

## Uncertain or unverified
- Habit thresholds are uncalibrated guesses (see `src/core/habits/constants.ts`). Only checked on three real accounts.
- `tilt-after-loss` does not normalise for time control; mixed bullet and slower games can produce a spurious difference.
- `no-resignation` measures playing on in hopeless positions, not actual resignations (Lichess PGN does not record resignation). It skips games under about 3 minutes.
- `FAST_MOVE_MIN_MS` is unreachable in practice (defensive).
- Classifier: mate scores are treated as plus or minus 1000 cp; "good" and "best" labels are our own; middlegame detection differs slightly from Lichess.
- The Anthropic path (`ANTHROPIC_API_KEY`) has only been run against a fake client, never against the real API. Token limits and effort settings are untuned. The prompt change (moves only via `mentionedMoves`, none in text) has never been tried on a real model, so the real acceptance rate is unknown: the strict free-text rule is over-inclusive (for example "B2B", "over a 3 game streak", any piece word followed by "to/on/at") and may send many real answers to the template fallback. That is safe but may make the LLM path rarely visible.
- LLM move validation: moves are accepted only through `mentionedMoves` (exact match with engine data; only the normalised engine move is stored and shown). LLM free text is rejected if, after normalisation (NFKD, invisible characters and combining marks removed, Cyrillic/Greek look-alikes folded, dashes unified), it contains a square (also across spaces or any punctuation, so "e/4" or "e(4)"), a spelled-out square (digit words, ordinals, Roman numerals, ES/FR/DE/RU-transliterated digit words), castling, promotion, en passant, "mate in N", "discovered check", a numbered move sequence, a figurine glyph, ANY piece word (English, German, French, Spanish, Russian transliterated; plural and possessive), or any letter outside plain a-z or non-ASCII digit. The rule is deliberately over-inclusive: harmless text such as "B2B", "a tour of the data", "a 3 game streak" or any mention of a queen or king (including "Martin Luther King") falls back to the template. That is safe but may make the LLM path rarely visible. Residual risk that no regex can close: pure prose that names neither a piece nor a square, for example "retreat one step" or "go back to the start", and other unanticipated paraphrases. The prompt forbids them. Also not handled: visual digit look-alikes such as "l" or "I" for 1. The non-English piece and digit word lists were not reviewed by native speakers, and the a-file spelled square ("a two") is only rejected with a movement word within four words or when another spelled square appears. The template fallback text names engine moves inline by design and is not subject to this rule.
- chess.com import has not been run against the live API in the app (only recorded fixtures and one archive parse).
- The full Lichess puzzle dump (about 290 MB) has not been indexed; only a 300,000-row sample. The rating window (plus or minus 300) is a guess.
- Node 20 needs the system `zstd` binary for `npm run setup:puzzles`.
- `better-sqlite3` is pinned to 12.x for Node 20; 13.x needs Node 22.
- Pasted PGN guesses the player as the most frequent name; the UI shows the guess.
- TypeScript is pinned to 5.9 and ESLint to 9; newer majors are unverified against Next 16.
- The web UI has been checked by tests, build and a dev-server smoke test (page loads, API accepts a job), not by a full browser walkthrough.
- CI workflow has never run (nothing pushed yet).
