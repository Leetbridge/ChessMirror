import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { formatDoctor, runDoctor, type DoctorDeps } from "../src/app/lib/doctor";
import { findStockfish } from "../src/app/lib/stockfish-path";

describe("findStockfish", () => {
  const onlyExec = (...paths: string[]) => (p: string) => paths.includes(p);

  it("prefers an explicit STOCKFISH_PATH even if it does not exist", () => {
    expect(findStockfish({ STOCKFISH_PATH: "/nope/stockfish" }, { platform: "linux", isExecutable: onlyExec("/usr/bin/stockfish") })).toBe("/nope/stockfish");
  });

  it("ignores a blank STOCKFISH_PATH and searches PATH first", () => {
    const env = { STOCKFISH_PATH: "  ", PATH: ["/a", "/b"].join(delimiter) };
    expect(findStockfish(env, { platform: "linux", isExecutable: onlyExec("/b/stockfish", "/usr/bin/stockfish") })).toBe("/b/stockfish");
  });

  it("falls back to common install folders", () => {
    expect(findStockfish({ PATH: "" }, { platform: "darwin", isExecutable: onlyExec("/opt/homebrew/bin/stockfish") })).toBe("/opt/homebrew/bin/stockfish");
  });

  it("looks for stockfish.exe on Windows and skips POSIX folders", () => {
    const env = { PATH: ["C:\\tools"].join(delimiter) };
    const found = findStockfish(env, { platform: "win32", isExecutable: (p) => p.endsWith("stockfish.exe") });
    expect(found).toMatch(/stockfish\.exe$/);
    expect(findStockfish({ PATH: "" }, { platform: "win32", isExecutable: () => true })).toBeUndefined();
  });

  it("ignores relative PATH entries such as . and bin", () => {
    const env = { PATH: [".", "bin", "./x", ""].join(delimiter) };
    const seen: string[] = [];
    const isExecutable = (p: string) => {
      seen.push(p);
      return p.startsWith(".") || p.startsWith("bin");
    };
    expect(findStockfish(env, { platform: "linux", isExecutable })).toBeUndefined();
    expect(seen.every((p) => p.startsWith("/"))).toBe(true);
  });

  it("returns undefined when nothing is found", () => {
    expect(findStockfish({ PATH: "/a" }, { platform: "linux", isExecutable: () => false })).toBeUndefined();
  });
});

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    env: {},
    platform: "darwin",
    nodeVersion: "20.19.0",
    fileExists: () => true,
    findStockfish: () => "/usr/local/bin/stockfish",
    probeEngine: async () => ({ ok: true, name: "Stockfish 18" }),
    hasZstd: () => true,
    ...over,
  };
}

describe("runDoctor", () => {
  it("passes on a healthy machine", async () => {
    const r = await runDoctor(deps());
    expect(r.every((c) => c.status !== "fail")).toBe(true);
    expect(formatDoctor(r)).toContain("Ready. Run: npm run dev");
  });

  it("fails with a platform hint when Stockfish is missing", async () => {
    const r = await runDoctor(deps({ findStockfish: () => undefined, platform: "linux" }));
    const sf = r.find((c) => c.name === "Stockfish");
    expect(sf?.status).toBe("fail");
    expect(sf?.hint).toContain("apt install stockfish");
    expect(formatDoctor(r)).toContain("[FAIL]");
  });

  it("fails when the binary does not answer as a UCI engine", async () => {
    const r = await runDoctor(deps({ probeEngine: async () => ({ ok: false, reason: "timed out" }) }));
    expect(r.find((c) => c.name === "Stockfish")?.message).toContain("timed out");
  });

  it("fails on an old Node and only warns for optional pieces", async () => {
    const r = await runDoctor(deps({ nodeVersion: "18.20.0", hasZstd: () => false, fileExists: () => false }));
    expect(r.find((c) => c.name === "Node.js")?.status).toBe("fail");
    expect(r.find((c) => c.name.startsWith("zstd"))?.status).toBe("warn");
    expect(r.find((c) => c.name === ".env")?.status).toBe("warn");
    expect(r.find((c) => c.name === "Puzzle index")?.status).toBe("warn");
  });

  it("never prints the API key", async () => {
    const r = await runDoctor(deps({ env: { ANTHROPIC_API_KEY: "sk-secret-value" } }));
    expect(formatDoctor(r)).not.toContain("sk-secret-value");
  });
});
