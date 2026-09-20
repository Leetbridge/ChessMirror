import { buildCoachContext, explainFindings, referencedMovesByFinding, type CoachEnv, type LlmProvider } from "../../core/coach";
import { ClassifyError, classifyGame, getPositions } from "../../core/classify";
import { FindingSchema, type AnalyzedGame, type Finding, type Game } from "../../core/domain";
import { EngineError, EngineNotFoundError, UciEngine, type EngineAnalyzer } from "../../core/engine";
import { detectHabits } from "../../core/habits";
import { ChessComSource, HttpError, LichessSource, parsePgnText, splitPgn, type FetchLike } from "../../core/import";
import { buildPlan } from "../../core/plan";
import type { PuzzleStore, Repository } from "../../core/store";
import { createMemoryRepository } from "./memory-repository";
import { attachPuzzles, estimateRating } from "./puzzles";
import { ResultSchema, type PuzzleRef, type AnalysisResult, type ImportRequest, type Progress } from "./types";

export const DEFAULT_DEPTH = 12;
export const DEFAULT_MAX_GAMES = 50;
const MAX_NAME_CHARS = 40;

export interface PipelineConfig {
  /** Fixed search depth per position (env CHESSMIRROR_DEPTH, 1 to 30). */
  depth: number;
  /** Most recent games analyzed per job (env CHESSMIRROR_MAX_GAMES, 1 to 200). */
  maxGames: number;
  /** Required for chess.com (env CHESSCOM_USER_AGENT). */
  chesscomUserAgent: string | undefined;
  /** env STOCKFISH_PATH. */
  stockfishPath: string | undefined;
}

function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function readConfig(env: CoachEnv): PipelineConfig {
  return {
    depth: intEnv(env["CHESSMIRROR_DEPTH"], DEFAULT_DEPTH, 1, 30),
    maxGames: intEnv(env["CHESSMIRROR_MAX_GAMES"], DEFAULT_MAX_GAMES, 1, 200),
    chesscomUserAgent: env["CHESSCOM_USER_AGENT"]?.trim() || undefined,
    stockfishPath: env["STOCKFISH_PATH"]?.trim() || undefined,
  };
}

/** An error whose message is safe to show to the user. */
export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

export type NamedEngine = EngineAnalyzer & { readonly name?: string | undefined };

export interface PipelineDeps {
  config: PipelineConfig;
  /** Passed to the coach for provider resolution (ANTHROPIC_API_KEY etc). */
  env?: CoachEnv;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to a UciEngine on config.stockfishPath. Closed when the run ends. */
  createEngine?: () => NamedEngine;
  repository?: Repository;
  /** Read-only puzzle index; when absent the result says puzzles are unavailable. */
  puzzleStore?: PuzzleStore;
  /** Called by whoever owns the resources (service or CLI) after the run, to close repository and puzzle store. */
  release?: () => void | Promise<void>;
  /** Explicit LLM provider (tests). Otherwise resolved from env; template when none. */
  provider?: LlmProvider;
  now?: () => Date;
  onProgress?: (p: Progress) => void;
  /** Called once per game the classifier rejects. */
  onSkip?: (gameId: string, reason: string) => void;
}

export interface PipelineOutput {
  result: AnalysisResult;
  analyzed: AnalyzedGame[];
  skipped: number;
  /** Coach summary text and how it was produced. */
  summary: string;
  coachSource: "llm" | "template";
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Turn low-level failures into messages a user can act on. */
export function toUserMessage(e: unknown, source: ImportRequest["source"]): string {
  if (e instanceof PipelineError) return e.message;
  if (e instanceof EngineNotFoundError) {
    return "Stockfish was not found. Install it and set STOCKFISH_PATH to the binary (see .env.example).";
  }
  if (e instanceof EngineError) return "The chess engine failed while analyzing. Check your Stockfish install and try again.";
  if (e instanceof HttpError) {
    if (e.status === 404) return `Username not found on ${source === "chesscom" ? "chess.com" : "Lichess"}.`;
    if (e.status === 429) return "The game source is rate limiting requests. Wait a few minutes and try again.";
    return `The game source returned an error (HTTP ${e.status}). Try again later.`;
  }
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return "The game source took too long to respond. Try again later.";
  }
  if (e instanceof TypeError) return "Could not reach the game source. Check your connection and try again.";
  return "The analysis failed unexpectedly.";
}

/**
 * Pasted PGN has no username. The player who appears in the most games is taken as the
 * user (ties go to the first name seen, i.e. White of the first game).
 */
export function inferHero(pgn: string): string | undefined {
  const counts = new Map<string, number>();
  const display = new Map<string, string>();
  for (const chunk of splitPgn(pgn)) {
    for (const tag of ["White", "Black"]) {
      const m = new RegExp(`^\\[${tag} "((?:[^"\\\\]|\\\\.)*)"\\]`, "m").exec(chunk);
      const name = m?.[1]?.replace(/\\(.)/g, "$1").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!display.has(key)) display.set(key, name.slice(0, MAX_NAME_CHARS));
    }
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best === undefined ? undefined : display.get(best);
}

async function importGames(
  request: ImportRequest,
  deps: PipelineDeps,
): Promise<{ games: Game[]; assumedPlayer?: string }> {
  const { config } = deps;
  const http = {
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  };
  if (request.source === "pgn") {
    const hero = inferHero(request.pgn);
    if (!hero) throw new PipelineError("Could not find any games with player names in that PGN.");
    const games = parsePgnText(request.pgn, { source: "pgn", username: hero, maxGames: config.maxGames }).games;
    return { games, assumedPlayer: hero };
  }
  if (request.source === "lichess") {
    return { games: await new LichessSource(http).fetchGames({ username: request.username, max: config.maxGames }) };
  }
  if (!config.chesscomUserAgent) {
    throw new PipelineError(
      "chess.com import needs CHESSCOM_USER_AGENT set (a descriptive name with a contact, see .env.example).",
    );
  }
  return {
    games: await new ChessComSource({ ...http, userAgent: config.chesscomUserAgent }).fetchGames({
      username: request.username,
      max: config.maxGames,
    }),
  };
}

/** Coach text replaces the detector's own explanation when it names the finding. */
function mergeExplanations(findings: Finding[], byId: Map<string, string>): Finding[] {
  return findings.map((f) => {
    const text = f.status === "detected" ? byId.get(f.id) : undefined;
    return text ? FindingSchema.parse({ ...f, explanation: text }) : f;
  });
}

export async function runPipeline(request: ImportRequest, deps: PipelineDeps): Promise<PipelineOutput> {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());
  const progress = (p: Progress) => deps.onProgress?.(p);
  const repo = deps.repository ?? createMemoryRepository();
  const engine: NamedEngine =
    deps.createEngine?.() ?? new UciEngine({ path: config.stockfishPath, defaultDepth: config.depth });

  try {
    // Fail fast on a missing Stockfish, before spending a network request.
    await engine.analyze(START_FEN, { depth: 1 });

    progress({ stage: "import", done: 0, total: 0 });
    const imported = await importGames(request, deps);
    const games = imported.games.filter((g) => g.moves.length > 0);
    await repo.saveGames(games);
    progress({ stage: "import", done: games.length, total: games.length });

    const analyzed: AnalyzedGame[] = [];
    let skipped = 0;
    progress({ stage: "engine", done: 0, total: games.length });
    for (const [i, game] of games.entries()) {
      try {
        const evals = [];
        for (const p of getPositions(game)) {
          evals.push(p.terminal ? null : await engine.analyze(p.fen, { depth: config.depth }));
        }
        const a = classifyGame(game, evals, { now: now(), ...(engine.name ? { engineName: engine.name } : {}) });
        analyzed.push(a);
        await repo.saveAnalyzedGame(a);
      } catch (e) {
        if (!(e instanceof ClassifyError)) throw e;
        skipped++;
        deps.onSkip?.(game.id, e.message);
      }
      progress({ stage: "engine", done: i + 1, total: games.length });
    }

    progress({ stage: "habits", done: 0, total: 1 });
    const detected = detectHabits(analyzed);
    progress({ stage: "habits", done: 1, total: 1 });

    progress({ stage: "plan", done: 0, total: 1 });
    const coachCtx = buildCoachContext(detected, analyzed);
    const coach = await explainFindings(coachCtx, {
      ...(deps.provider ? { provider: deps.provider } : {}),
      env: deps.env ?? {},
    });
    const findings = mergeExplanations(
      detected,
      new Map(coach.advice.findings.map((f) => [f.findingId, f.explanation])),
    );
    // Only normalised engine moves are stored. A schema problem here must never fail the analysis: drop the display.
    const referencedParsed =
      coach.source === "llm"
        ? ResultSchema.shape.referencedMoves.safeParse(referencedMovesByFinding(coach.advice, coachCtx))
        : undefined;
    const referencedMoves = referencedParsed?.success ? referencedParsed.data : undefined;
    const plan = buildPlan(findings, { now: now().toISOString() });
    await repo.saveFindings(findings);
    await repo.savePlan(plan);
    progress({ stage: "plan", done: 1, total: 1 });

    // A broken puzzle DB must never fail the analysis: report puzzles as unavailable instead.
    let puzzles: Record<string, PuzzleRef[]> | undefined;
    if (deps.puzzleStore) {
      try {
        puzzles = attachPuzzles(plan, deps.puzzleStore, estimateRating(analyzed));
      } catch {
        puzzles = undefined;
      }
    }

    const result = ResultSchema.parse({
      gamesAnalyzed: analyzed.length,
      findings,
      plan,
      ...(referencedMoves && Object.keys(referencedMoves).length > 0 ? { referencedMoves } : {}),
      puzzlesAvailable: puzzles !== undefined,
      ...(puzzles ? { drillPuzzles: puzzles } : {}),
      ...(imported.assumedPlayer ? { assumedPlayer: imported.assumedPlayer } : {}),
    });
    return { result, analyzed, skipped, summary: coach.advice.summary, coachSource: coach.source };
  } finally {
    await engine.close().catch(() => undefined);
  }
}
