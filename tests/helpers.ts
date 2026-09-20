import { Chess } from "chess.js";
import type { PositionEval } from "../src/core/domain";
import type { EngineAnalyzer } from "../src/core/engine";
import { readFixture } from "./fixtures/load";

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Deterministic stand-in for Stockfish: White-POV material balance in centipawns. */
export function materialEval(fen: string): PositionEval {
  let cp = 0;
  for (const ch of fen.split(" ")[0] ?? "") {
    const v = VALUES[ch.toLowerCase()];
    if (v !== undefined) cp += ch === ch.toLowerCase() ? -v * 100 : v * 100;
  }
  return { evalCp: cp, depth: 12, bestMoveUci: firstLegalUci(fen) };
}

function firstLegalUci(fen: string): string {
  const m = new Chess(fen).moves({ verbose: true })[0];
  return m ? `${m.from}${m.to}${m.promotion ?? ""}` : "a1a2";
}

export class FakeEngine implements EngineAnalyzer {
  readonly name = "FakeFish 1";
  calls: { fen: string; depth: number | undefined }[] = [];
  closed = false;
  async analyze(fen: string, options?: { depth?: number }): Promise<PositionEval> {
    this.calls.push({ fen, depth: options?.depth });
    return materialEval(fen);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** N copies of one fixture game, each on a different day so each gets its own game id. */
export function copies(file: string, n: number): string {
  const base = readFixture(file);
  return Array.from({ length: n }, (_, i) =>
    base.replace(/\[Date "[^"]*"\]/, `[Date "2026.01.${String(i + 1).padStart(2, "0")}"]`),
  ).join("\n\n");
}

export function fakeFetch(body: string, status = 200) {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    return new Response(body, { status });
  };
  return { fetch, urls };
}

