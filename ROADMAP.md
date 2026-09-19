# Roadmap

Plans, not promises. Only v0 is under active work. Scope may change; stack changes go through an ADR.

## v0: Habit mirror (in progress)
- Import games from Lichess, chess.com or PGN.
- Local Stockfish analysis (external process), move classification, game phase, clock extraction.
- Five habit detectors with evidence and "insufficient data" handling: blunders in time trouble, tilt after a loss, throwing away winning positions, too-fast moves in critical positions, never resigning lost games.
- Plan with chess drills, soft-skill drills and Lichess puzzle themes.
- Coaching text via an optional LLM provider (Anthropic) or a template fallback.
- Local-first dashboard. No accounts.

## v1: Curriculum
- A structured beginner-to-intermediate course path (reserved `courses` module).
- Lessons and exercises linked to the player's findings.
- Progress tracking.

## v2: Repertoire
- Opening repertoire building and review (reserved `repertoire` module).
- Opening data from the Lichess explorer. Whether it requires authentication is unverified.

## v3: Endgames
- Endgame training and tablebase-backed feedback (reserved `endgames` module).

## v4: Advanced mirror and voice
- Richer behavioral tracking over time and a voice coach (reserved `mirror` and `voice` modules).
- Advanced material toward the grandmaster end of the curriculum.
- Still hypotheses only, never emotion detection.

## Known risks
See "Known risks" in [docs/TASKS.md](docs/TASKS.md).
