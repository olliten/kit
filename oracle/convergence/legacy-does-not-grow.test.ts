import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { type LegacySizeFinding, legacySize } from "../../src/core/readings/legacy-size.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const gateSource =
  process.env.KIT_GATE_SOURCE ?? new URL("../../scripts/kit-check.mjs", import.meta.url).href;
const { ratchetFindings, tightenedBaseline } = await import(gateSource);

const growth = DEFAULT_CONFIG.legacyGrowth;
const legacy = "src/legacy/report.ts";
const placed = {
  "src/core/readings/total.ts":
    "export function total(values: readonly number[]): number {\n  let sum = 0;\n  for (const value of values) sum += value;\n  return sum;\n}\n",
};
const helper = {
  "src/legacy/helper.ts": "export function helper(value: number): number {\n  return value + 1;\n}\n",
};
// Seven statements: both imports, the function, the variable, the `if` and both returns. The first import and
// the variable only reach the placed module; the helper is legacy and `String` the host's, so the rest are
// the module's own.
const report = (extra = ""): string =>
  'import { total } from "../core/readings/total.js";\n' +
  'import { helper } from "./helper.js";\n\n' +
  "export function report(values: readonly number[]): string {\n" +
  "  const sum = total(values);\n" +
  extra +
  "  if (sum > 100) {\n" +
  '    return "large";\n' +
  "  }\n" +
  "  return String(helper(sum));\n" +
  "}\n";

type Baseline = Record<string, { statements: number; calls: number }>;

function measure(files: Readonly<Record<string, string>>): LegacySizeFinding[] {
  return legacySize(sourceFixture({ ...placed, ...helper, ...files }));
}

const recorded = (findings: readonly LegacySizeFinding[]): Baseline =>
  Object.fromEntries(
    findings.map((item) => [item.debtKey, { statements: item.statements, calls: item.calls }]),
  );

const failures = (findings: readonly LegacySizeFinding[], baseline: Baseline): string[] =>
  ratchetFindings(findings, baseline, [], [], [], growth).map(
    (item: { readonly path: string }) => item.path,
  );

const sizeOf = (findings: readonly LegacySizeFinding[], path = legacy) =>
  findings
    .filter((item) => item.path === path)
    .map(({ statements, calls }) => ({ statements, calls }))[0];

const before = measure({ [legacy]: report() });
const baseline = recorded(before);
const ifBlock = '  if (sum > 100) {\n    return "large";\n  }\n';
const calls = (count: number): string => "  total(values);\n".repeat(count);

test("a legacy module's size is its statements, and those that only call into placed modules", () => {
  expect(sizeOf(before)).toEqual({ statements: 7, calls: 2 });
  expect(sizeOf(before, "src/legacy/helper.ts")).toEqual({ statements: 2, calls: 0 });
  expect(before.map((item) => item.debtKey)).toEqual([
    "R1:legacy-size:src/legacy/helper.ts",
    `R1:legacy-size:${legacy}`,
  ]);
  expect(before.every((item) => item.category === "legacy-debt")).toBe(true);
  expect(measure({ [legacy]: report(), "src/core/readings/extra.ts": "export const extra = 1;\n" })).toEqual(
    before,
  );
  expect(failures(before, baseline)).toEqual([]);
});

test("the Kit allows a legacy module no growth, not even one call into a placed module", () => {
  expect(growth).toBe(0);
  const grown = measure({ [legacy]: report(calls(1)) });
  expect(sizeOf(grown)).toEqual({ statements: 8, calls: 3 });
  expect(failures(grown, baseline)).toEqual([legacy]);
  const [failure] = ratchetFindings(grown, baseline, [], [], [], growth);
  expect(failure.fix).toContain("may add no statements to a legacy module");
  expect(failure.fix).not.toContain("at most");
  expect(measure({ [legacy]: report() })[1]?.fix).toContain("Add no statements to this legacy module");
});

test("a supplied allowance admits only that many calls into placed modules", () => {
  const allowance = 2;
  const within = measure({ [legacy]: report(calls(allowance)) });
  expect(ratchetFindings(within, baseline, [], [], [], allowance)).toEqual([]);
  const beyond = measure({ [legacy]: report(calls(allowance + 1)) });
  const [failure] = ratchetFindings(beyond, baseline, [], [], [], allowance);
  expect(failure.path).toBe(legacy);
  expect(failure.fix).toContain(`at most ${allowance}`);
});

test("one added statement that is not a call into a placed module fails", () => {
  const own = ["  const doubled = sum * 2;\n", "  helper(sum);\n", "  report([]);\n", "  console.log(sum);\n"];
  for (const extra of own) {
    const grown = measure({ [legacy]: report(extra) });
    expect(sizeOf(grown)?.statements).toBe(8);
    expect(failures(grown, baseline)).toEqual([legacy]);
  }
  const nested = measure({ [legacy]: report("  total([1].map((value) => {\n    return value * 2;\n  }));\n") });
  expect(sizeOf(nested)).toEqual({ statements: 9, calls: 3 });
  expect(failures(nested, baseline)).toEqual([legacy]);
});

test("a shrink tightens the baseline, so later growth counts from the smaller size", () => {
  const shrunk = measure({
    [legacy]: report().replace(ifBlock, ""),
  });
  expect(sizeOf(shrunk)).toEqual({ statements: 5, calls: 2 });
  expect(failures(shrunk, baseline)).toEqual([]);
  const tightened = tightenedBaseline(baseline, shrunk);
  expect(tightened[`R1:legacy-size:${legacy}`]).toEqual({ statements: 5, calls: 2 });
  const regrown = measure({
    [legacy]: report(calls(growth + 1)).replace(ifBlock, ""),
  });
  expect(failures(regrown, baseline)).toEqual([]);
  expect(failures(regrown, tightened)).toEqual([legacy]);
});

test("tightening never records growth and drops the size of a module that is gone", () => {
  const grown = measure({ [legacy]: report(calls(1)) });
  expect(tightenedBaseline(baseline, grown)).toEqual(baseline);
  const swapped = measure({ [legacy]: report(calls(2)).replace(ifBlock, "") });
  expect(sizeOf(swapped)).toEqual({ statements: 7, calls: 4 });
  expect(failures(swapped, baseline)).toEqual([]);
  expect(tightenedBaseline(baseline, swapped)[`R1:legacy-size:${legacy}`]).toEqual({
    statements: 7,
    calls: 4,
  });
  const gone = measure({});
  expect(tightenedBaseline(baseline, gone)).toEqual({
    "R1:legacy-size:src/legacy/helper.ts": { statements: 2, calls: 0 },
  });
});

test("a verbatim move into a placed module passes", () => {
  const withMean =
    report("  const average = mean(values);\n") +
    "function mean(values: readonly number[]): number {\n" +
    "  if (values.length === 0) return 0;\n" +
    "  return total(values) / values.length;\n" +
    "}\n";
  const kept = measure({ [legacy]: withMean });
  expect(sizeOf(kept)).toEqual({ statements: 12, calls: 2 });
  const moved = measure({
    [legacy]:
      'import { mean } from "../core/readings/mean.js";\n' +
      report("  const average = mean(values);\n"),
    "src/core/readings/mean.ts":
      'import { total } from "./total.js";\n\n' +
      "export function mean(values: readonly number[]): number {\n" +
      "  if (values.length === 0) return 0;\n" +
      "  return total(values) / values.length;\n" +
      "}\n",
  });
  expect(sizeOf(moved)).toEqual({ statements: 9, calls: 4 });
  expect(failures(moved, recorded(kept))).toEqual([]);
});

test("a formatting-only change moves neither number", () => {
  const reformatted = measure({
    [legacy]:
      'import { total } from "../core/readings/total.js"\nimport { helper } from "./helper.js"\n' +
      "export function report(values: readonly number[]): string { const sum = total(values)\n" +
      '  if (sum > 100) return "large"; return String(helper(sum)) }\n',
  });
  expect(reformatted).toEqual(before);
  expect(failures(reformatted, baseline)).toEqual([]);
});

test("a new legacy module, or one without a recorded size, is new debt", () => {
  const added = measure({
    [legacy]: report(),
    "src/legacy/new.ts": "export const value = 1;\n",
    "src/core/readings/.hidden.ts": "export const value = 1;\n",
  });
  expect(failures(added, baseline)).toEqual([
    "src/core/readings/.hidden.ts",
    "src/legacy/new.ts",
  ]);
  const keysOnly = Object.keys(baseline);
  expect(failures(before, keysOnly as unknown as Baseline)).toEqual([
    "src/legacy/helper.ts",
    legacy,
  ]);
});

test("a placed module and a host entry have no legacy size", () => {
  const startup = "src/start.ts";
  const snapshot = sourceFixture(
    { ...placed, [startup]: 'import { total } from "./core/readings/total.js";\ntotal([]);\n' },
    { hosts: { browser: { lib: ["dom"], zone: "shell", entries: [startup] } } },
  );
  expect(snapshot.sizes?.map((size) => size.file)).toEqual([
    "src/core/readings/total.ts",
    startup,
  ]);
  expect(legacySize(snapshot)).toEqual([]);
});
