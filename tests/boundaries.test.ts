import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const eslint = new ESLint({ cwd: root });

async function lint(relPath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, relPath) });
  return result?.messages ?? [];
}

const boundaryErrors = (messages: { ruleId: string | null }[]) =>
  messages.filter((m) => m.ruleId?.startsWith("boundaries/"));

describe("import boundaries (ARCHITECTURE.md dependency table)", () => {
  it("allows habits -> domain", async () => {
    const m = await lint("src/core/habits/probe.ts", 'import type { Finding } from "../domain";\nexport type T = Finding;\n');
    expect(boundaryErrors(m)).toEqual([]);
  });

  it("allows plan -> puzzles", async () => {
    const m = await lint("src/core/plan/probe.ts", 'import "../puzzles";\n');
    expect(boundaryErrors(m)).toEqual([]);
  });

  it("allows app -> any core module", async () => {
    const m = await lint("src/app/probe.ts", 'import "../core/engine";\nimport "../core/coach";\n');
    expect(boundaryErrors(m)).toEqual([]);
  });

  it("rejects habits -> engine", async () => {
    const m = await lint("src/core/habits/probe.ts", 'import "../engine";\n');
    expect(boundaryErrors(m).length).toBeGreaterThan(0);
  });

  it("rejects coach -> engine", async () => {
    const m = await lint("src/core/coach/probe.ts", 'import "../engine";\n');
    expect(boundaryErrors(m).length).toBeGreaterThan(0);
  });

  it("rejects domain -> any other module", async () => {
    const m = await lint("src/core/domain/probe.ts", 'import "../store";\n');
    expect(boundaryErrors(m).length).toBeGreaterThan(0);
  });

  it("rejects core -> app", async () => {
    const m = await lint("src/core/plan/probe.ts", 'import "../../app/page";\n');
    expect(boundaryErrors(m).length).toBeGreaterThan(0);
  });
});
