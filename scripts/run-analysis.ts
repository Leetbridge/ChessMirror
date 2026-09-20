/**
 * Run the analysis pipeline from the command line and print the result as JSON on stdout.
 * Progress and warnings go to stderr.
 *
 *   npx tsx --env-file=.env scripts/run-analysis.ts lichess <username> [maxGames]
 *   npx tsx --env-file=.env scripts/run-analysis.ts chesscom <username> [maxGames]
 *   npx tsx --env-file=.env scripts/run-analysis.ts pgn <file.pgn> [maxGames]
 *
 * Env: STOCKFISH_PATH, CHESSMIRROR_DEPTH (default 12), CHESSMIRROR_MAX_GAMES (default 50),
 * CHESSCOM_USER_AGENT (chess.com only), ANTHROPIC_API_KEY (optional, otherwise template text).
 */
import { PgnFileError, readPgnFile } from "../src/app/lib/pgn-file";
import { readConfig, runPipeline, toUserMessage } from "../src/app/lib/pipeline";
import { ImportRequestSchema, type ImportRequest } from "../src/app/lib/types";

async function main(): Promise<number> {
  const [source, target, max] = process.argv.slice(2);
  if ((source !== "lichess" && source !== "chesscom" && source !== "pgn") || !target) {
    console.error("Usage: run-analysis.ts <lichess|chesscom|pgn> <username|file.pgn> [maxGames]");
    return 2;
  }
  let pgn = "";
  if (source === "pgn") {
    try {
      pgn = readPgnFile(target);
    } catch (e) {
      console.error(e instanceof PgnFileError ? e.message : "Could not read the PGN file.");
      return 2;
    }
  }
  const parsed = ImportRequestSchema.safeParse(source === "pgn" ? { source, pgn } : { source, username: target });
  if (!parsed.success) {
    console.error("Invalid input: check the username or PGN.");
    return 2;
  }
  const request: ImportRequest = parsed.data;

  const config = readConfig(process.env);
  if (max !== undefined) {
    const n = Number(max);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      console.error("maxGames must be an integer from 1 to 200.");
      return 2;
    }
    config.maxGames = n;
  }

  try {
    const out = await runPipeline(request, {
      config,
      env: process.env,
      onProgress: (p) => console.error(`[${p.stage}] ${p.done}/${p.total}`),
      onSkip: (id, reason) => console.error(`skipped ${id}: ${reason}`),
    });
    console.log(
      JSON.stringify(
        {
          gamesAnalyzed: out.result.gamesAnalyzed,
          ...(out.result.assumedPlayer ? { assumedPlayer: out.result.assumedPlayer } : {}),
          skipped: out.skipped,
          depth: config.depth,
          coachSource: out.coachSource,
          summary: out.summary,
          findings: out.result.findings,
          plan: out.result.plan,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (e) {
    console.error(toUserMessage(e, request.source));
    if (process.env["DEBUG"]) console.error(e);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
