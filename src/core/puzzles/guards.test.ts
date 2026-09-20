import { describe, expect, it } from "vitest";
import { guardedLines, isAllowedPuzzleUrl, zstdExitOk } from "./guards";

async function collect(gen: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const l of gen) out.push(l);
  return out;
}
async function* chunks(...xs: (string | Uint8Array)[]) {
  for (const x of xs) yield x;
}

describe("isAllowedPuzzleUrl", () => {
  it("accepts only https on database.lichess.org", () => {
    expect(isAllowedPuzzleUrl("https://database.lichess.org/lichess_db_puzzle.csv.zst")).toBe(true);
    expect(isAllowedPuzzleUrl("http://database.lichess.org/x")).toBe(false);
    expect(isAllowedPuzzleUrl("https://database.lichess.org.evil.com/x")).toBe(false);
    expect(isAllowedPuzzleUrl("https://evil.com/database.lichess.org/")).toBe(false);
    expect(isAllowedPuzzleUrl("https://database.lichess.org@evil.com/")).toBe(false);
    expect(isAllowedPuzzleUrl("not a url")).toBe(false);
  });
});

describe("zstdExitOk", () => {
  const base = { code: null, signal: null, killedByUs: false, limited: false };
  it("accepts exit code 0", () => expect(zstdExitOk({ ...base, code: 0 })).toBe(true));
  it("rejects non-zero exit", () => expect(zstdExitOk({ ...base, code: 1 })).toBe(false));
  it("rejects a foreign signal on a full run", () => expect(zstdExitOk({ ...base, signal: "SIGKILL" })).toBe(false));
  it("tolerates a signal we sent, or any signal with --limit", () => {
    expect(zstdExitOk({ ...base, signal: "SIGKILL", killedByUs: true })).toBe(true);
    expect(zstdExitOk({ ...base, signal: "SIGKILL", limited: true })).toBe(true);
  });
});

describe("guardedLines", () => {
  const opts = { maxBytes: 1000, maxLineBytes: 20 };
  it("splits lines across chunk and multi-byte boundaries", async () => {
    const e = new TextEncoder().encode("é,b\r\nc\nlast");
    const lines = await collect(guardedLines(chunks(e.slice(0, 1), e.slice(1)), opts));
    expect(lines).toEqual(["é,b", "c", "last"]);
  });
  it("rejects a newline-less stream", async () => {
    await expect(collect(guardedLines(chunks("x".repeat(30)), opts))).rejects.toThrow(/Line longer/);
  });
  it("rejects too many decompressed bytes", async () => {
    await expect(collect(guardedLines(chunks("a\n".repeat(600)), opts))).rejects.toThrow(/exceeded/);
  });
});
