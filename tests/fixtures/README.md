# Test fixtures

All PGNs in `pgn/` are **synthetic**: hand-written for testing, every move verified legal with chess.js 1.4.0 (except the Crazyhouse drops, see below). None of them claims to be a real or historic game; players are named `Synthetic*` and every `[Event]` starts with `Synthetic`.

`manifest.json` declares the expected properties of every game. `tests/golden/fixtures.test.ts` checks the declarations against the files using only chess.js. Other tests can load the manifest with `tests/fixtures/load.ts` (`loadManifest`, `readFixture`, `splitGames`, `rawHeaders`, `parseClkSeconds`).

Conventions: ply counts are half-moves. "Clocks" means `[%clk H:MM:SS]` comments. Material uses P1 N3 B3 R5 Q9, from the hero's point of view.

| File | Games | Result | Plies | Clocks | Purpose |
| --- | --- | --- | --- | --- | --- |
| `short_fools_mate.pgn` | 1 | 0-1 (mate) | 4 | all | Shortest game, integer-second clocks |
| `short_scholars_mate.pgn` | 1 | 1-0 (mate) | 7 | none | Short game without clocks |
| `aborted_no_moves.pgn` | 1 | `*` | 0 | none | Aborted, no movetext. Must be skipped |
| `aborted_two_plies.pgn` | 1 | 1-0 | 2 | all | Abandoned after 2 plies, too short to analyse |
| `clocks_resignation_chesscom_style.pgn` | 1 | 1-0 | 20 | all, tenths | chess.com-style `0:09:56.7` clocks, "won by resignation" termination |
| `no_clocks_resignation.pgn` | 1 | 0-1 | 20 | none | No clock data, `TimeControl "-"` |
| `ending_draw_agreed_clocks_eval.pgn` | 1 | 1/2-1/2 | 16 | all | Lichess-style `{ [%eval x] [%clk y] }` combined comments, 300+3 |
| `clocks_partial.pgn` | 1 | 1/2-1/2 | 20 | 12 of 20 | Missing-clock robustness |
| `time_trouble_blunder_timeout.pgn` | 1 | 0-1 (time) | 38 | all | Hero (White) under 10s from ply 33, hangs the queen at ply 37, flags. Min hero clock 3s |
| `winning_position_thrown_away.pgn` | 1 | 0-1 | 34 | all | Hero (White) +11 at ply 21, ends -6 |
| `lost_game_played_to_mate.pgn` | 1 | 1-0 (mate) | 37 | all | Hero (Black) 5+ points down from ply 15 (8+ from ply 21) and plays on 11 more moves to mate. "Never resigns": no resignation must be inferred |
| `variant_chess960_replayable.pgn` | 1 | 1-0 | 4 | all | `Variant "Chess960"` with a `KQkq` FEN that chess.js accepts. Skip by tag |
| `variant_chess960_xfen.pgn` | 1 | 1-0 | n/a | none | `Variant "Chess960"` with `HFhf` X-FEN. chess.js 1.4.0 throws, so the tag check must precede parsing |
| `variant_crazyhouse_drop.pgn` | 1 | 1-0 | n/a | none | `Variant "Crazyhouse"` with drop moves (`P@e6`). chess.js cannot parse it. Legality not verified (no variant engine here) |
| `variant_king_of_the_hill_legal_moves.pgn` | 1 | 1-0 | 6 | none | Variant tag on legal standard moves: parses fine, so skipping must rely on the tag |
| `odd_headers.pgn` | 1 | 1-0 | 4 | none | Accents, CJK, brackets, semicolons, apostrophes, `?` and `????.??.??` values |
| `odd_headers_escaped_quote.pgn` | 1 | 1-0 | n/a | none | PGN-standard `\"` escapes in tag values. chess.js 1.4.0 rejects the whole game (known limitation) |
| `multi_game.pgn` | 5 | mixed | 4, 7, n/a, 0, 8 | mixed | Clocked mate, unclocked mate, Crazyhouse, aborted, clocked draw, separated by blank lines |

## Findings about chess.js 1.4.0 worth knowing

- `loadPgn` throws on illegal moves, drop moves (`P@e6`), and backslash-escaped quotes in tag values.
- `loadPgn` throws on FEN castling fields written as file letters (`HFhf`). `KQkq` is accepted even for a Chess960 start.
- It parses one game per call. Multi-game files must be split first (`splitGames`).
- `getHeaders()` fills the Seven Tag Roster with `?` defaults for missing tags; read raw tags (`rawHeaders`) if you need to know what was actually present.
- Comments are exposed by `getComments()` keyed by the FEN after the move; `[%clk]` and `[%eval]` remain raw text.
- A game with a result token and no moves loads fine (0 plies).

## Notes and limits

- Resignation is not encoded in PGN by Lichess (`Termination "Normal"` covers resignation and mate). `no_clocks_resignation.pgn` and the "resignation" termination strings follow chess.com wording only as a plausible shape. A resignation detector must infer resignation from result plus the absence of checkmate/stalemate, not from a tag.
- Time-trouble and blunder properties are declared through clocks and material only. No engine evaluation is asserted.
- "Huge PGN" handling is tested by concatenating `multi_game.pgn` 500 times inside the test, so no large file is committed.
