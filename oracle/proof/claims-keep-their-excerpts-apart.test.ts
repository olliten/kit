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

function snapshot(module: string, text = source): Snapshot {
  return {
    ...projectSnapshot(recordedFunctions({ [module]: text })),
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
  tests: { "oracle/text/sums.test.ts": { [module]: sums }, "oracle/text/formats.test.ts": { [module]: formats } },
  contexts: Object.fromEntries(["oracle/text/sums.test.ts", "oracle/text/formats.test.ts"].map((test) => [test, {
    complete: true, runtime: "fixture", loaded: [test, module],
  }])),
});

test("a module holding code only one claim runs, for each of two claims, is several modules", () => {
  const module = "src/core/readings/text.ts";
  const findings = excerptCohesion(snapshot(module), ran(module, ["parse@1", "sum@2"], ["parse@1", "format@3", "pad@4"]));
  expect(findings.map(({ debtKey }) => debtKey)).toEqual([
    `R4:excerpt-cohesion:${module}:spec%2Ftext.md%3Aformats:format`,
    `R4:excerpt-cohesion:${module}:spec%2Ftext.md%3Aformats:format.pad`,
    `R4:excerpt-cohesion:${module}:spec%2Ftext.md%3Asums:sum`,
  ]);
  expect(findings.every(({ fix }) => /own module|separate module/.test(fix))).toBe(true);
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

test("a new exclusive function adds debt without replacing the existing obligations", () => {
  const module = "src/core/readings/text.ts";
  const oldRuns = ran(module, ["parse@1", "sum@2"], ["parse@1", "format@3", "pad@4"]);
  const original = excerptCohesion(snapshot(module), oldRuns).map(({ debtKey }) => debtKey);
  const added = snapshot(module, source + "export function trim(text: string): string { return text.trim(); }\n");
  const result = excerptCohesion(added, ran(module, ["parse@1", "sum@2", "trim@7"], ["parse@1", "format@3", "pad@4"]));
  expect(result.map(({ debtKey }) => debtKey)).toEqual(expect.arrayContaining(original));
  expect(result.filter(({ debtKey }) => !original.includes(debtKey)).map(({ debtKey }) => debtKey)).toEqual([
    `R4:excerpt-cohesion:${module}:spec%2Ftext.md%3Asums:trim`,
  ]);
});

test("integration execution cannot manufacture a shared excerpt or mask independent debt", () => {
  const module = "src/core/readings/text.ts";
  const value = snapshot(module);
  const integration = "oracle/text/sums.browser.test.ts";
  const context = ran(module, ["parse@1", "sum@2"], ["parse@1", "format@3", "pad@4"]);
  const original = excerptCohesion(value, context);
  expect(excerptCohesion(value, {
    tests: { ...context.tests, [integration]: { [module]: ["format@3", "pad@4"] } },
    contexts: { ...context.contexts, [integration]: { complete: false, runtime: "fixture", loaded: [module] } },
  })).toEqual(original);
});
