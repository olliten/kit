import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { proofReach } from "../../src/core/readings/proof-reach.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

// A test reaches what its code uses, followed through helpers as the compiler sees it, not every module a helper
// it imports could load.
const app = (files: Readonly<Record<string, string>>): string[] => {
  const root = mkdtempSync(join(tmpdir(), "kit-proof-use-"));
  try {
    const inputs: Record<string, string> = {
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], strict: true, noEmit: true },
        include: ["oracle/**/*.ts", "src/**/*.ts"],
      }),
      "spec/topic.md": "# Topic\n\nTotals.\n\n## Totals\n\n- Totals sum steps. {{total}} {{step}} {#total-sums}\n",
      "src/core/primitives/step.ts": "export interface Step {\n  readonly size: number;\n}\n",
      "src/core/readings/total.ts":
        'import type { Step } from "../primitives/step.js";\nexport const total = (steps: readonly Step[]): number => steps.length;\n',
      "src/core/readings/average.ts": "export const average = (n: readonly number[]): number => n.length;\n",
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return proofReach(readSnapshot(root)).map((finding) => finding.debtKey);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const UNREACHED = "R4:unreached-module:spec/topic.md:total-sums:total";
const STEP_UNREACHED = "R4:unreached-module:spec/topic.md:total-sums:step";
const HELPER = [
  'import { total } from "../../src/core/readings/total.js";',
  'import { average } from "../../src/core/readings/average.js";',
  "export const totalOf = (): number => total([]);",
  "export const averageOf = (): number => average([]);",
  "",
].join("\n");

test("a test that calls a helper's function reaches the modules that function uses, and the types they use", () => {
  expect(
    app({
      "oracle/lib/helper.ts": HELPER,
      "oracle/topic/total-sums.test.ts": 'import { totalOf } from "../lib/helper.js";\nvoid totalOf();\n',
    }),
  ).toEqual([]);
});

test("a helper that imports a module lends it only to the tests whose code uses it", () => {
  expect(
    app({
      "oracle/lib/helper.ts": HELPER,
      "oracle/topic/total-sums.test.ts": 'import { averageOf } from "../lib/helper.js";\nvoid averageOf();\n',
    }),
  ).toEqual([STEP_UNREACHED, UNREACHED]);
});

test("a helper that loads a module by a literal dynamic import reaches it for the tests that call it", () => {
  expect(
    app({
      "oracle/lib/load.ts": 'export const load = () => import("../../src/core/readings/total.js");\n',
      "oracle/topic/total-sums.test.ts": 'import { load } from "../lib/load.js";\nawait load();\n',
    }),
  ).toEqual([]);
});

test("a test that imports a module for its effect alone runs it", () => {
  expect(
    app({ "oracle/topic/total-sums.test.ts": 'import "../../src/core/readings/total.js";\n' }),
  ).toEqual([]);
});

test("a test that imports a module but never uses it doesn't reach it", () => {
  expect(
    app({
      "oracle/topic/total-sums.test.ts":
        'import { total } from "../../src/core/readings/total.js";\nimport type { Step } from "../../src/core/primitives/step.js";\nexport type Steps = Step[];\nexport type Total = typeof total;\n',
    }),
  ).toEqual([UNREACHED]);
});
