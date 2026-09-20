/**
 * Thresholds for the five habit detectors.
 *
 * Every number here is a heuristic starting point, NOT a validated value.
 * They have not been calibrated on real player data yet; tune them against
 * golden PGN sets (see docs/TASKS.md, QA) before trusting severities.
 */

/** Minimum games any detector needs before it will report anything. */
export const MIN_GAMES = 5;

/** Minimum games for tilt-after-loss, which needs a baseline and a post-loss sample. */
export const MIN_GAMES_TILT = 10;

/** Max evidence refs attached to one finding (keeps the UI and prompts small). */
export const MAX_EVIDENCE = 10;

/** A game counts as "having clock data" if this share of the user's moves has clockMs. */
export const CLOCK_COVERAGE_MIN = 0.5;

/** Minimum games with clock data for clock-based detectors. */
export const MIN_CLOCKED_GAMES = 5;

// --- Blunders in time trouble ---

/** Time trouble = user's clock at or below this fraction of the initial time... */
export const TIME_TROUBLE_FRACTION = 0.1;
/** ...capped at this many ms (so 15+10 is not "trouble" at 1.5 minutes). */
export const TIME_TROUBLE_CAP_MS = 60_000;
/** Fallback threshold when the game has no time control metadata. */
export const TIME_TROUBLE_FALLBACK_MS = 30_000;
/** Minimum user moves made in time trouble (across games) to compare rates. */
export const TT_MIN_MOVES = 10;
/** Minimum blunders in time trouble to report. */
export const TT_MIN_BLUNDERS = 3;
/** Blunder rate in time trouble must be at least this multiple of the normal rate. */
export const TT_RATE_RATIO = 2;
/** Share of all blunders made in time trouble: medium / high severity cut-offs. */
export const TT_SEVERITY_MEDIUM = 0.35;
export const TT_SEVERITY_HIGH = 0.5;

// --- Tilt after a loss ---

/**
 * A game "follows a loss" if it starts within this many minutes of the START of
 * the previous (lost) game. We only know start times, not end times, so this is
 * an approximation of "same session". Uncertain: 45 min suits blitz/rapid.
 */
export const TILT_WINDOW_MIN = 45;
/** Minimum post-loss games and baseline games. */
export const TILT_MIN_POST_GAMES = 3;
export const TILT_MIN_BASELINE_GAMES = 3;
/** Minimum blunders in post-loss games to report. */
export const TILT_MIN_BLUNDERS = 3;
/** Post-loss blunder-per-move rate vs baseline: minimum ratio and absolute difference. */
export const TILT_RATE_RATIO = 1.5;
export const TILT_MIN_RATE_DIFF = 0.015;
// Known limitation: tilt compares a player's own post-loss games with their other
// games without normalising for time control. A player who mixes bullet and slower
// games may show a spurious difference. Not handled in v0.
/** Ratio cut-offs for severity. */
export const TILT_SEVERITY_MEDIUM = 2;
export const TILT_SEVERITY_HIGH = 3;

// --- Throwing away winning positions ---

/** Mover win% at or above which a position is "clearly winning". */
export const WINNING_WIN_PCT = 80;
/** Games that reached a winning position, minimum, to judge conversion. */
export const THROW_MIN_WINNING_GAMES = 3;
/** Minimum thrown games to report. */
export const THROW_MIN_THROWN = 3;
/** Share of winning-position games not converted to a win. */
export const THROW_MIN_SHARE = 0.3;
export const THROW_SEVERITY_MEDIUM = 0.45;
export const THROW_SEVERITY_HIGH = 0.6;

// --- Too-fast moves in critical positions ---

/**
 * Time-control model shared by the detectors below. A game's estimated length is
 * `initialSec + EST_MOVES * incrementSec` (the Lichess-style "estimated duration").
 * Uncalibrated.
 */
export const EST_MOVES = 40;
/**
 * Games with a known estimated length under this many seconds (bullet and below)
 * are excluded from fast-critical-moves and no-resignation: in bullet nearly every
 * move is fast and playing on is often rational (the opponent may flag).
 * 180 matches the Lichess bullet/blitz boundary (3+0 is the shortest included).
 */
export const MIN_ESTIMATED_TOTAL_SEC = 180;

/**
 * "Fast" is relative to the time control: at most this fraction of the per-move
 * budget (estimated length / EST_MOVES)...
 */
export const FAST_BUDGET_FRACTION = 0.2;
/** ...clamped to this range in ms (so 10+0 gives 3s, 3+0 gives 0.9s, 15+10 gives 5s). */
export const FAST_MOVE_MIN_MS = 500;
export const FAST_MOVE_MAX_MS = 5_000;
/** "Critical" = mover win% before the move within this band (position still balanced/decidable). */
export const CRITICAL_MIN_WIN_PCT = 30;
export const CRITICAL_MAX_WIN_PCT = 85;
/** Minimum fast errors (mistake or blunder) to report, and across at least this many games. */
export const FAST_MIN_ERRORS = 4;
export const FAST_MIN_GAMES = 3;
/** Share of errors (with ample clock) that were fast. */
export const FAST_MIN_SHARE = 0.5;
export const FAST_SEVERITY_HIGH = 0.7;

// --- Never resigning lost games ---

/** Mover win% at or below which the position is treated as hopeless. */
export const HOPELESS_WIN_PCT = 5;
/** User moves played while hopeless to count as "played on" (~8 moves). */
export const PLAY_ON_MOVES = 8;
/** Minimum lost games that were hopeless at some point. */
export const RESIGN_MIN_HOPELESS_GAMES = 4;
/** Minimum played-on games and share of hopeless lost games. */
export const RESIGN_MIN_PLAYED_ON = 3;
export const RESIGN_MIN_SHARE = 0.5;
export const RESIGN_SEVERITY_HIGH = 0.75;
