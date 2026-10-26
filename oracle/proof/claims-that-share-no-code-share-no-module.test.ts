import { expect, test } from "vitest";
import { claimCohesion } from "../../src/core/readings/claim-cohesion.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const tally = "src/core/readings/tally.ts";
const topic = (anchors: readonly string[]): string =>
  "# Tally\n\nCounts things.\n\n## Counting\n\n" +
  anchors.map((anchor) => `- Claim ${anchor}. · {#${anchor}}\n  - Implementation: {{tally}}\n`).join("");
const uses = (call: string): string => `import { ${call.split("(")[0]} } from '../../src/core/readings/tally.js';\nvoid ${call};\n`;

function findings(tests: Readonly<Record<string, string>>, module = "") {
  const snapshot = sourceFixture(
    {
      "spec/terms.md": "# Terms\n\n- **tally** — counts.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/tally.md": topic(Object.keys(tests)),
      [tally]:
        module ||
        "export function count(values: readonly number[]): number { return values.length; }\n" +
          "export function total(values: readonly number[]): number { return values.reduce((a, b) => a + b, 0); }\n" +
          "export function mean(values: readonly number[]): number { return total(values) / count(values); }\n",
      ...Object.fromEntries(Object.entries(tests).map(([anchor, call]) => [`oracle/tally/${anchor}.test.ts`, uses(call)])),
    },
    { srcRoot: ["src", "oracle"] },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return claimCohesion(snapshot);
}

test("claims whose tests use disjoint declarations of the module they name are a finding", () => {
  expect(findings({ counts: "count([1])", totals: "total([1])" })).toEqual([
    expect.objectContaining({
      debtKey: `R4:claim-cohesion:${tally}`,
      fix: expect.stringContaining("{counts} and {totals}"),
    }),
  ]);
});

test("a claim whose code uses both parts connects them", () => {
  expect(findings({ counts: "count([1])", totals: "total([1])", means: "mean([1])" })).toEqual([]);
});

test("claims sharing a declaration are one group", () => {
  expect(findings({ counts: "count([1])", sizes: "count([2])" })).toEqual([]);
});

test("a module of only types links no claims", () => {
  const types = "export interface Tally { readonly count: number; }\nexport const empty: Tally = { count: 0 };\n";
  expect(
    findings(
      {
        counts: "empty",
        totals: "empty",
      },
      types,
    ),
  ).toEqual([]);
});
