import { z } from "zod";
import {
  MoveClassSchema,
  type AnalyzedGame,
  type DetectedFinding,
  type Finding,
} from "../domain";

/** Engine-derived facts about one position that a finding points at. */
export const EngineMoveRefSchema = z.object({
  gameId: z.string().min(1),
  ply: z.number().int().positive(),
  playedSan: z.string().min(1),
  playedUci: z.string().min(4).max(5),
  /** Engine's preferred move, from engine output only. */
  bestUci: z.string().min(4).max(5).optional(),
  bestSan: z.string().min(1).optional(),
  clockMs: z.number().int().nonnegative().optional(),
  moveClass: MoveClassSchema.optional(),
  winPctBefore: z.number().min(0).max(100).optional(),
  winPctAfter: z.number().min(0).max(100).optional(),
});
export type EngineMoveRef = z.infer<typeof EngineMoveRefSchema>;

/** Non-sensitive game facts. Player names are deliberately omitted (untrusted text). */
export const GameRefSchema = z.object({
  id: z.string().min(1),
  url: z.string().optional(),
  playedAt: z.string(),
  userColor: z.enum(["white", "black"]),
  result: z.enum(["win", "loss", "draw", "unknown"]),
  timeControl: z.string().optional(),
});
export type GameRef = z.infer<typeof GameRefSchema>;

export interface CoachContext {
  findings: Finding[];
  games: GameRef[];
  moves: EngineMoveRef[];
}

export function detectedFindings(ctx: CoachContext): DetectedFinding[] {
  return ctx.findings.filter((f): f is DetectedFinding => f.status === "detected");
}

function relativeResult(g: AnalyzedGame["game"]): GameRef["result"] {
  if (g.result === "unknown") return "unknown";
  if (g.result === "draw") return "draw";
  return g.result === g.userColor ? "win" : "loss";
}

function timeControlLabel(g: AnalyzedGame["game"]): string | undefined {
  const tc = g.timeControl;
  return tc ? `${tc.initialSec}+${tc.incrementSec}` : undefined;
}

/** Derive the coach's data from findings plus the analyzed games their evidence points at. */
export function buildCoachContext(findings: Finding[], analyzed: AnalyzedGame[]): CoachContext {
  const byId = new Map(analyzed.map((a) => [a.game.id, a]));
  const games = new Map<string, GameRef>();
  const moves = new Map<string, EngineMoveRef>();

  for (const f of findings) {
    if (f.status !== "detected") continue;
    for (const ev of f.evidence) {
      const a = byId.get(ev.gameId);
      if (!a) continue;
      if (!games.has(a.game.id)) {
        games.set(a.game.id, {
          id: a.game.id,
          ...(a.game.url ? { url: a.game.url } : {}),
          playedAt: a.game.playedAt,
          userColor: a.game.userColor,
          result: relativeResult(a.game),
          ...(timeControlLabel(a.game) ? { timeControl: timeControlLabel(a.game) } : {}),
        });
      }
      const m = a.moves.find((x) => x.ply === ev.ply);
      const key = `${ev.gameId}#${ev.ply}`;
      if (!m || moves.has(key)) continue;
      moves.set(key, {
        gameId: ev.gameId,
        ply: ev.ply,
        playedSan: m.san,
        playedUci: m.uci,
        ...(m.bestMoveUci ? { bestUci: m.bestMoveUci } : {}),
        ...(m.clockMs !== undefined ? { clockMs: m.clockMs } : {}),
        moveClass: m.class,
        ...(m.winPctBefore !== undefined ? { winPctBefore: m.winPctBefore } : {}),
        winPctAfter: m.winPct,
      });
    }
  }
  return { findings, games: [...games.values()], moves: [...moves.values()] };
}

/** Every SAN/UCI string the LLM is allowed to mention, normalised (no check/annotation marks). */
export function allowedMoves(ctx: CoachContext): Set<string> {
  const out = new Set<string>();
  for (const m of ctx.moves) {
    for (const s of [m.playedSan, m.playedUci, m.bestSan, m.bestUci]) {
      if (s) out.add(normalizeMove(s));
    }
  }
  return out;
}

export function normalizeMove(s: string): string {
  return s.normalize("NFKC").trim().replace(/[+#!?]+$/g, "");
}

export function formatClock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${s}s`;
}
