import { expect, test } from "vitest";
import type { Runs } from "../../src/core/primitives/runs.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { functionGovernance } from "../../src/core/readings/function-governance.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedFunctions } from "../substrate/compositions/recorded-functions.js";

const module = "src/core/readings/total.ts";
const source =
  "export function total(values: readonly number[]): number {\n" +
  "  return values.reduce((sum, value) => sum + value, 0);\n" +
  "}\n" +
  "export const average = (values: readonly number[]): number => total(values) / values.length;\n" +
  "export const rounding = { half: (value: number): number => Math.round(value * 2) / 2 };\n";

function snapshot(): Snapshot {
  const facts = recordedFunctions({ [module]: source });
  return {
    ...projectSnapshot(facts),
    files: [
      { path: module, type: "source" },
      { path: "oracle/sums/total-sums.test.ts", type: "test" },
      { path: "oracle/sums/rounds-halves.test.ts", type: "test" },
    ],
    claims: [
      { file: "spec/sums.md", anchor: "total-sums", line: 1, terms: ["total"] },
      { file: "spec/sums.md", anchor: "rounds-halves", line: 2, terms: [] },
    ],
  };
}

const keys = (runs: Runs): string[] => functionGovernance(snapshot(), runs).map((item) => `${item.debtKey} ${item.fix}`);

test("a module's named functions are recorded with the name a runtime reports, its line and the function holding it", () => {
  expect(recordedFunctions({ [module]: source }).functions?.map(({ name, line, id, holder }) => [name, line, id, holder])).toEqual([
    ["total", 1, "total", null],
    ["average", 4, "average", null],
    ["half", 5, "half", null],
  ]);
});

test("a function a claim naming its module runs is governed; an anonymous function belongs to the one holding it", () => {
  expect(
    keys({ digests: {}, tests: { "oracle/sums/total-sums.test.ts": { [module]: ["total@1", "average@4", "half@5"] } } }),
  ).toEqual([]);
});

test("a function only claims that don't name the module run is debt, and so is one no test runs", () => {
  expect(
    keys({
      digests: {},
      tests: {
        "oracle/sums/total-sums.test.ts": { [module]: ["total@1"] },
        "oracle/sums/rounds-halves.test.ts": { [module]: ["half@5"] },
      },
    }),
  ).toEqual([
    `R4:ungoverned-function:${module}:average No test runs average: prove it from a claim that names this module, or delete it.`,
    `R4:ungoverned-function:${module}:half Only claims that don't name this module run half: prove it from a claim that names the module.`,
  ]);
  expect(functionGovernance(snapshot(), { digests: {}, tests: {} }).every((item) => item.category === "legacy-debt")).toBe(true);
});
