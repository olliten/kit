import { expect, test } from "vitest";
import type { Runs } from "../../src/core/primitives/runs.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { excerptCohesion } from "../../src/core/readings/excerpt-cohesion.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedFunctions } from "../substrate/compositions/recorded-functions.js";

const source =
  "export function parse(text: string): string[] { return text.split(','); }\n" +
  "export function sum(text: string): number { return parse(text).length; }\n" +
  "export function format(text: string): string {\n" +
  "  const pad = (value: string): string => value.padStart(4);\n" +
  "  return parse(text).map(pad).join('');\n" +
  "}\n";

function snapshot(module: string): Snapshot {
  return {
    ...projectSnapshot(recordedFunctions({ [module]: source })),
    files: [
      { path: module, type: "source" },
      { path: "oracle/text/sums.test.ts", type: "test" },
      { path: "oracle/text/formats.test.ts", type: "test" },
    ],
    claims: [
      { file: "spec/text.md", anchor: "sums", line: 1, terms: [] },
      { file: "spec/text.md", anchor: "formats", line: 2, terms: [] },
    ],
  };
}

const ran = (module: string, sums: string[], formats: string[]): Runs => ({
  digests: {},
  tests: { "oracle/text/sums.test.ts": { [module]: sums }, "oracle/text/formats.test.ts": { [module]: formats } },
});

test("a module holding code only one claim runs, for each of two claims, is several modules", () => {
  const module = "src/core/readings/text.ts";
  expect(excerptCohesion(snapshot(module), ran(module, ["parse@1", "sum@2"], ["parse@1", "format@3", "pad@4"])).map((item) => [item.debtKey, item.fix])).toEqual([
    [
      `R4:excerpt-cohesion:${module}`,
      "These claims each run code of this module no other claim runs: formats (format, format.pad); sums (sum). Move each claim's excerpt into its own module.",
    ],
  ]);
});

test("code every claim runs is the shared core, and a function held by shared code is part of it", () => {
  const module = "src/core/readings/text.ts";
  expect(excerptCohesion(snapshot(module), ran(module, ["parse@1", "sum@2"], ["parse@1"]))).toEqual([]);
  expect(excerptCohesion(snapshot(module), ran(module, ["parse@1", "format@3"], ["parse@1", "format@3", "pad@4"]))).toEqual([]);
});

test("an adapter's operations may serve different claims", () => {
  const module = "src/substrate/adapters/text.ts";
  expect(excerptCohesion(snapshot(module), ran(module, ["parse@1", "sum@2"], ["parse@1", "format@3"]))).toEqual([]);
});
