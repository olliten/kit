import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { proofReach } from "../../src/core/readings/proof-reach.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

// A test that imports through a tsconfig `paths` alias reaches the module the compiler resolves it to.
const options = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  types: [],
  strict: true,
  noEmit: true,
};
const app = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(join(tmpdir(), "kit-proof-paths-"));
  try {
    const inputs: Record<string, string> = {
      "package.json": JSON.stringify({ type: "module" }),
      "spec/topic.md": "# Topic\n\nTotals.\n\n## Totals\n\n- Totals sum. {{total}} {#total-sums}\n",
      "src/core/readings/total.ts": "export const total = (n: number[]): number => n.length;\n",
      "src/core/readings/average.ts": "export const average = (n: number[]): number => n.length;\n",
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const snapshot = readSnapshot(root);
    return {
      keys: proofReach(snapshot).map((finding) => finding.debtKey),
      edges: snapshot.imports.map(({ from, to }) => `${from} > ${to}`),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const project = (paths: Readonly<Record<string, readonly string[]>>) =>
  JSON.stringify({ compilerOptions: { ...options, paths }, include: ["oracle/**/*.ts", "src/**/*.ts"] });
const UNREACHED = "R4:unreached-module:spec/topic.md:total-sums:total";

test("a test importing the named module through a paths alias reaches it", () => {
  expect(
    app({
      "tsconfig.json": project({ "@src/*": ["./src/core/readings/*"] }),
      "oracle/topic/total-sums.test.ts": 'import { total } from "@src/total.js";\nvoid total;\n',
    }).keys,
  ).toEqual([]);
});

test("a test importing an unrelated module through a paths alias leaves the named module unreached", () => {
  expect(
    app({
      "tsconfig.json": project({ "@src/*": ["./src/core/readings/*"] }),
      "oracle/topic/total-sums.test.ts": 'import { average } from "@src/average.js";\nvoid average;\n',
    }).keys,
  ).toEqual([UNREACHED]);
});

test("relative imports reach as before, with or without paths", () => {
  const test = 'import { total } from "../../src/core/readings/total.js";\nvoid total;\n';
  expect(app({ "oracle/topic/total-sums.test.ts": test })).toEqual({
    keys: [],
    edges: ["oracle/topic/total-sums.test.ts > src/core/readings/total.ts"],
  });
  expect(
    app({
      "tsconfig.json": project({ "@src/*": ["./src/core/readings/*"] }),
      "oracle/topic/total-sums.test.ts": test,
    }).edges,
  ).toEqual(["oracle/topic/total-sums.test.ts > src/core/readings/total.ts"]);
});

test("an alias without a project, or a file outside every project, reaches nothing", () => {
  const test = 'import { total } from "@src/total.js";\nvoid total;\n';
  expect(app({ "oracle/topic/total-sums.test.ts": test }).keys).toEqual([UNREACHED]);
  expect(
    app({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, paths: { "@src/*": ["./src/core/readings/*"] } },
        include: ["src/**/*.ts"],
      }),
      "oracle/topic/total-sums.test.ts": test,
    }).keys,
  ).toEqual([UNREACHED]);
});

// The compiler tries a pattern's substitutions in order and takes the first that exists, as here a legacy
// module of the same name listed before the placed one.
test("an alias reaches the first of its substitutions that exists", () => {
  const files = {
    "src/legacy/total.ts": "export const total = (n: number[]): number => n.length;\n",
    "oracle/topic/total-sums.test.ts": 'import { total } from "@src/total.js";\nvoid total;\n',
  };
  const legacyFirst = app({
    ...files,
    "tsconfig.json": project({ "@src/*": ["./src/legacy/*", "./src/core/readings/*"] }),
  });
  expect(legacyFirst.edges).toEqual(["oracle/topic/total-sums.test.ts > src/legacy/total.ts"]);
  expect(legacyFirst.keys).toEqual([UNREACHED]);
  const placedFirst = app({
    ...files,
    "tsconfig.json": project({ "@src/*": ["./src/core/readings/*", "./src/legacy/*"] }),
  });
  expect(placedFirst.edges).toEqual(["oracle/topic/total-sums.test.ts > src/core/readings/total.ts"]);
  expect(placedFirst.keys).toEqual([]);
});

// Of two patterns that both match, the compiler takes the one with the longer prefix, whatever their order.
test("of two matching paths patterns, the alias reaches what the compiler chooses", () => {
  expect(
    app({
      "src/legacy/total.ts": "export const total = (n: number[]): number => n.length;\n",
      "tsconfig.json": project({ "@src/*": ["./src/core/readings/*"], "@src/t*": ["./src/legacy/t*"] }),
      "oracle/topic/total-sums.test.ts": 'import { total } from "@src/total.js";\nvoid total;\n',
    }),
  ).toEqual({ keys: [UNREACHED], edges: ["oracle/topic/total-sums.test.ts > src/legacy/total.ts"] });
});

// `paths` resolve from the `baseUrl` of the extended config that declares them, through a helper.
test("an alias declared in an extended config with a baseUrl reaches through a helper", () => {
  expect(
    app({
      "config/tsconfig.base.json": JSON.stringify({
        compilerOptions: { ...options, baseUrl: "..", paths: { "@src/*": ["src/core/readings/*"] } },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "./config/tsconfig.base.json",
        include: ["oracle/**/*.ts", "src/**/*.ts"],
      }),
      "oracle/lib/fixture.ts": 'export { total } from "@src/total.js";\n',
      "oracle/topic/total-sums.test.ts": 'import { total } from "../lib/fixture.js";\nvoid total;\n',
    }),
  ).toEqual({
    keys: [],
    edges: [
      "oracle/lib/fixture.ts > src/core/readings/total.ts",
      "oracle/topic/total-sums.test.ts > oracle/lib/fixture.ts",
    ],
  });
});
