import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

// Module dependency table from ARCHITECTURE.md. Keep in sync with it.
const allowed = {
  domain: [],
  import: ["domain"],
  engine: ["domain"],
  classify: ["domain"],
  habits: ["domain"],
  puzzles: ["domain", "store"],
  plan: ["domain", "habits", "puzzles"],
  coach: ["domain"],
  store: ["domain"],
};

const coreModules = Object.keys(allowed);

const policies = [
  ...Object.entries(allowed)
    .filter(([, deps]) => deps.length > 0)
    .map(([mod, deps]) => ({
      from: { element: { type: mod } },
      allow: { to: { element: { types: deps } } },
    })),
  // Only src/app wires modules together.
  {
    from: { element: { type: "app" } },
    allow: { to: { element: { types: coreModules } } },
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**", "tests/fixtures/**", ".claude/worktrees/**"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        ...coreModules.map((mod) => ({ type: mod, pattern: `src/core/${mod}` })),
        { type: "app", pattern: "src/app" },
      ],
    },
    rules: {
      "boundaries/dependencies": [2, { default: "disallow", policies }],
    },
  },
]);
