import type { AnalyzedGame, DetectedFinding, EvidenceRef } from "../domain";
import * as C from "./constants";
import {
  capEvidence,
  confidence,
  fastMoveMs,
  hasClockData,
  insufficient,
  isBulletOrShorter,
  outcome,
  ref,
  severityBy,
  spentMs,
  timeTroubleMs,
  userMoves,
  winPctBefore,
} from "./helpers";
import { TEXT, type DetectorId } from "./text";
import type { HabitDetector } from "./types";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function detected(
  id: DetectorId,
  f: { evidence: EvidenceRef[]; severity: DetectedFinding["severity"]; confidence: number; explanation: string },
): DetectedFinding {
  const t = TEXT[id];
  return {
    id,
    detector: id,
    status: "detected",
    ...f,
    evidence: capEvidence(f.evidence),
    chessDrill: t.chessDrill,
    softSkillDrill: t.softSkillDrill,
  };
}

// 1. Blunders in time trouble ---------------------------------------------------

export const timeTroubleBlunders: HabitDetector = (games) => {
  const id = "time-trouble-blunders";
  const clocked = games.filter(hasClockData);
  if (clocked.length < C.MIN_CLOCKED_GAMES) {
    return insufficient(id, `Needs at least ${C.MIN_CLOCKED_GAMES} games with clock data; found ${clocked.length}.`);
  }
  let ttMoves = 0, ttBlunders = 0, otherMoves = 0, otherBlunders = 0;
  const evidence: EvidenceRef[] = [];
  const gameIds = new Set<string>();
  for (const g of clocked) {
    const limit = timeTroubleMs(g);
    for (const m of userMoves(g)) {
      if (m.clockMs === undefined) continue;
      const blunder = m.class === "blunder";
      if (m.clockMs <= limit) {
        ttMoves++;
        if (blunder) {
          ttBlunders++;
          gameIds.add(g.game.id);
          evidence.push(ref(g.game.id, m.ply, `blunder with ${Math.round(m.clockMs / 1000)}s left`));
        }
      } else {
        otherMoves++;
        if (blunder) otherBlunders++;
      }
    }
  }
  if (ttMoves < C.TT_MIN_MOVES) {
    return insufficient(id, `Needs at least ${C.TT_MIN_MOVES} moves played in time trouble; found ${ttMoves}.`);
  }
  const ttRate = ttBlunders / ttMoves;
  const otherRate = otherMoves > 0 ? otherBlunders / otherMoves : 0;
  if (ttBlunders < C.TT_MIN_BLUNDERS || ttRate < C.TT_RATE_RATIO * otherRate) return null;
  const share = ttBlunders / (ttBlunders + otherBlunders);
  return detected(id, {
    evidence,
    severity: severityBy(share, C.TT_SEVERITY_MEDIUM, C.TT_SEVERITY_HIGH),
    confidence: confidence(ttBlunders, 10),
    explanation:
      `${ttBlunders} of ${plural(ttBlunders + otherBlunders, "blunder")} (${pct(share)}) happened with little time left: ` +
      `roughly ${pct(ttRate)} of moves in time trouble versus ${pct(otherRate)} otherwise, across ${plural(gameIds.size, "game")}. ` +
      `This is consistent with running short on time lowering move quality, and may suggest that too much time is spent earlier in the game.`,
  });
};

// 2. Tilt after a loss ----------------------------------------------------------

export const tiltAfterLoss: HabitDetector = (games) => {
  const id = "tilt-after-loss";
  if (games.length < C.MIN_GAMES_TILT) {
    return insufficient(id, `Needs at least ${C.MIN_GAMES_TILT} games; found ${games.length}.`);
  }
  const sorted = [...games].sort((a, b) => Date.parse(a.game.playedAt) - Date.parse(b.game.playedAt));
  const post: AnalyzedGame[] = [];
  const base: AnalyzedGame[] = [];
  sorted.forEach((g, i) => {
    const prev = sorted[i - 1];
    const gapMin = prev ? (Date.parse(g.game.playedAt) - Date.parse(prev.game.playedAt)) / 60_000 : Infinity;
    (prev && outcome(prev) === "loss" && gapMin <= C.TILT_WINDOW_MIN ? post : base).push(g);
  });
  if (post.length < C.TILT_MIN_POST_GAMES) {
    return insufficient(
      id,
      `Needs at least ${C.TILT_MIN_POST_GAMES} games started within ${C.TILT_WINDOW_MIN} minutes after a loss; found ${post.length}.`,
    );
  }
  if (base.length < C.TILT_MIN_BASELINE_GAMES) {
    return insufficient(id, `Needs at least ${C.TILT_MIN_BASELINE_GAMES} other games as a baseline; found ${base.length}.`);
  }
  const rate = (gs: AnalyzedGame[]) => {
    let mv = 0, bl = 0;
    for (const g of gs) for (const m of userMoves(g)) { mv++; if (m.class === "blunder") bl++; }
    return { mv, bl, r: mv > 0 ? bl / mv : 0 };
  };
  const p = rate(post), b = rate(base);
  if (p.bl < C.TILT_MIN_BLUNDERS || p.r < C.TILT_RATE_RATIO * b.r || p.r - b.r < C.TILT_MIN_RATE_DIFF) return null;
  const evidence = post.flatMap((g) =>
    userMoves(g).filter((m) => m.class === "blunder").map((m) => ref(g.game.id, m.ply, "blunder in game played soon after a loss")),
  );
  const ratio = b.r > 0 ? p.r / b.r : Infinity;
  return detected(id, {
    evidence,
    severity: severityBy(ratio, C.TILT_SEVERITY_MEDIUM, C.TILT_SEVERITY_HIGH),
    confidence: confidence(post.length, 10),
    explanation:
      `In ${plural(post.length, "game")} started soon after a loss, blunders came at ${pct(p.r)} of moves versus ${pct(b.r)} in your other games. ` +
      `This is consistent with play getting looser right after a defeat; it may suggest that a short break between games could help.`,
  });
};

// 3. Throwing away winning positions --------------------------------------------

export const thrownWins: HabitDetector = (games) => {
  const id = "thrown-wins";
  const known = games.filter((g) => outcome(g) !== "unknown");
  if (known.length < C.MIN_GAMES) {
    return insufficient(id, `Needs at least ${C.MIN_GAMES} games with a known result; found ${known.length}.`);
  }
  const winning = known.filter((g) => userMoves(g).some((m) => m.winPct >= C.WINNING_WIN_PCT));
  if (winning.length < C.THROW_MIN_WINNING_GAMES) {
    return insufficient(
      id,
      `Needs at least ${C.THROW_MIN_WINNING_GAMES} games with a clearly winning position; found ${winning.length}.`,
    );
  }
  const evidence: EvidenceRef[] = [];
  let thrown = 0;
  for (const g of winning) {
    if (outcome(g) === "win") continue;
    thrown++;
    const mine = userMoves(g);
    const firstWin = mine.findIndex((m) => m.winPct >= C.WINNING_WIN_PCT);
    let worst = mine[firstWin + 1];
    let drop = -Infinity;
    for (const m of mine.slice(firstWin + 1)) {
      const d = winPctBefore(g, m) - m.winPct;
      if (d > drop) { drop = d; worst = m; }
    }
    // Fall back to the first winning move when the advantage faded without a later user move.
    const at = worst ?? mine[firstWin];
    if (at) evidence.push(ref(g.game.id, at.ply, `advantage lost; game ${outcome(g)}`));
  }
  const share = thrown / winning.length;
  if (thrown < C.THROW_MIN_THROWN || share < C.THROW_MIN_SHARE) return null;
  return detected(id, {
    evidence,
    severity: severityBy(share, C.THROW_SEVERITY_MEDIUM, C.THROW_SEVERITY_HIGH),
    confidence: confidence(winning.length, 12),
    explanation:
      `${thrown} of ${plural(winning.length, "game")} where you reached a clearly winning position ended without a win (${pct(share)}). ` +
      `This is consistent with difficulty converting an advantage, and may suggest that a simpler, safer plan when ahead would help.`,
  });
};

// 4. Too-fast moves in critical positions ---------------------------------------

export const fastCriticalMoves: HabitDetector = (games) => {
  const id = "fast-critical-moves";
  const withClock = games.filter(hasClockData);
  // "Fast" only makes sense relative to the time control; skip bullet and unknown time controls.
  const clocked = withClock.filter((g) => fastMoveMs(g) !== undefined);
  if (clocked.length < C.MIN_CLOCKED_GAMES) {
    return insufficient(
      id,
      `Needs at least ${C.MIN_CLOCKED_GAMES} games with clock data and a known time control of at least ${C.MIN_ESTIMATED_TOTAL_SEC}s estimated length (bullet games are excluded, since almost every move is fast there); found ${clocked.length} of ${withClock.length} games with clock data.`,
    );
  }
  let errors = 0, fast = 0;
  const evidence: EvidenceRef[] = [];
  const gameIds = new Set<string>();
  for (const g of clocked) {
    const limit = timeTroubleMs(g);
    const fastLimit = fastMoveMs(g) ?? 0;
    for (const m of userMoves(g)) {
      if (m.class !== "mistake" && m.class !== "blunder") continue;
      const before = winPctBefore(g, m);
      const spent = spentMs(g, m);
      if (spent === undefined || m.clockMs === undefined) continue;
      // Only errors with ample clock and in still-decidable positions (time trouble has its own detector).
      if (m.clockMs <= limit || before < C.CRITICAL_MIN_WIN_PCT || before > C.CRITICAL_MAX_WIN_PCT) continue;
      errors++;
      if (spent <= fastLimit) {
        fast++;
        gameIds.add(g.game.id);
        evidence.push(ref(g.game.id, m.ply, `${m.class} played in ${(spent / 1000).toFixed(1)}s in a critical position`));
      }
    }
  }
  const share = errors > 0 ? fast / errors : 0;
  if (fast < C.FAST_MIN_ERRORS || gameIds.size < C.FAST_MIN_GAMES || share < C.FAST_MIN_SHARE) return null;
  return detected(id, {
    evidence,
    severity: share >= C.FAST_SEVERITY_HIGH ? "high" : "medium",
    confidence: confidence(fast, 10),
    explanation:
      `${fast} of ${plural(errors, "mistake")} made with plenty of time on the clock in balanced positions were played quickly for the time control (${pct(share)}), across ${plural(gameIds.size, "game")}. ` +
      `This is consistent with moving quickly in moments that deserve a longer think, and may suggest slowing down when the position gets sharp.`,
  });
};

// 5. Never resigning lost games -------------------------------------------------

/**
 * Resignation is not reliably recorded across sources, so this measures
 * "playing on while hopeless" rather than resignation itself.
 */
export const noResignation: HabitDetector = (games) => {
  const id = "no-resignation";
  if (games.length < C.MIN_GAMES) {
    return insufficient(id, `Needs at least ${C.MIN_GAMES} games; found ${games.length}.`);
  }
  // Bullet is excluded: playing on is often rational there because the opponent may flag.
  // Games without a time control are kept (we cannot tell).
  const eligible = games.filter((g) => !isBulletOrShorter(g));
  if (eligible.length < C.MIN_GAMES) {
    return insufficient(
      id,
      `Needs at least ${C.MIN_GAMES} games with a time control of at least ${C.MIN_ESTIMATED_TOTAL_SEC}s estimated length (bullet games are excluded, since playing on is often reasonable there); found ${eligible.length} of ${games.length}.`,
    );
  }
  const lost = eligible.filter((g) => outcome(g) === "loss");
  const hopeless = lost
    .map((g) => {
      const mine = userMoves(g);
      const idx = mine.findIndex((m) => m.winPct <= C.HOPELESS_WIN_PCT);
      if (idx < 0) return undefined;
      const first = mine[idx];
      const count = mine.slice(idx).filter((m) => m.winPct <= C.HOPELESS_WIN_PCT).length;
      return first ? { g, first, count } : undefined;
    })
    .filter((x) => x !== undefined);
  if (hopeless.length < C.RESIGN_MIN_HOPELESS_GAMES) {
    return insufficient(
      id,
      `Needs at least ${C.RESIGN_MIN_HOPELESS_GAMES} lost games with a hopeless position; found ${hopeless.length}.`,
    );
  }
  const playedOn = hopeless.filter((h) => h.count >= C.PLAY_ON_MOVES);
  const share = playedOn.length / hopeless.length;
  if (playedOn.length < C.RESIGN_MIN_PLAYED_ON || share < C.RESIGN_MIN_SHARE) return null;
  return detected(id, {
    evidence: playedOn.map((h) => ref(h.g.game.id, h.first.ply, `hopeless position, ${h.count} more moves played`)),
    severity: share >= C.RESIGN_SEVERITY_HIGH ? "high" : "medium",
    confidence: confidence(hopeless.length, 8),
    explanation:
      `In ${playedOn.length} of ${plural(hopeless.length, "lost game")} you kept playing for ${C.PLAY_ON_MOVES} or more moves in a position the engine rated as hopeless (${pct(share)}). ` +
      `This is consistent with reluctance to end a lost game; it may suggest that resigning earlier would free time for review. Some sources do not record resignations, so this is a hypothesis.`,
  });
};
