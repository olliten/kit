import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { coverageReport } from "../../src/core/readings/coverage-report.js";
import { testRuns } from "../../src/core/readings/test-runs.js";
import { runRuns } from "../../src/substrate/compositions/runs-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const report = [
  "TN:",
  "SF:/app/src/core/readings/total.ts",
  "FN:1,total",
  "FN:4,anonymous_1",
  "FN:6,visit",
  "FN:9,visit",
  "FN:12,(anonymous_2)",
  "FN:14,16,average",
  "FNDA:3,total",
  "FNDA:3,anonymous_1",
  "FNDA:0,visit",
  "FNDA:2,visit",
  "FNDA:1,(anonymous_2)",
  "FNDA:0,average",
  "end_of_record",
].join("\n");

test("an LCOV report lists each file's named functions by line, pairing alike names in order", () => {
  expect(coverageReport(report)).toEqual([
    {
      file: "/app/src/core/readings/total.ts",
      functions: [
        { name: "total", line: 1, count: 3 },
        { name: "visit", line: 6, count: 0 },
        { name: "visit", line: 9, count: 2 },
        { name: "average", line: 14, count: 0 },
      ],
    },
  ]);
});

test("a test's record holds the named functions it ran and the digests of the files it reaches and ran", () => {
  const files = [
    { path: "src/core/readings/total.ts", type: "source" as const, digest: "a" },
    { path: "src/core/readings/round.ts", type: "source" as const, digest: "d" },
    { path: "src/core/readings/unused.ts", type: "source" as const, digest: "e" },
    { path: "lib/old.ts", type: "source" as const, digest: "b" },
    { path: "oracle/sums/total-sums.test.ts", type: "test" as const, digest: "c" },
  ];
  const inputs = new Map([["oracle/sums/total-sums.test.ts", ["oracle/sums/total-sums.test.ts", "src/core/readings/round.ts"]]]);
  expect(testRuns([{ test: "oracle/sums/total-sums.test.ts", lcov: [report], v8: [] }], files, "/app", { srcRoot: "src" }, inputs)).toEqual([
    {
      test: "oracle/sums/total-sums.test.ts",
      digests: { "oracle/sums/total-sums.test.ts": "c", "src/core/readings/round.ts": "d", "src/core/readings/total.ts": "a" },
      ran: { "src/core/readings/total.ts": ["total@1", "visit@9"] },
    },
  ]);
});

const sumsTest =
  "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../../src/core/readings/total.ts';\n" +
  "test('sums', () => { assert.equal(total([1, 2]), 3); });\n";
const roundsTest =
  "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { round } from '../../src/core/readings/round.ts';\n" +
  "test('rounds', () => { assert.equal(round(1.4), 1); });\n";

test("kit runs records each test alone, and reruns only what changed, what it is given, or everything", async () => {
  const project = temporaryProjects.open("kit-runs-");
  const config = join(project.root, "kit/config.md");
  const runs = (...args: string[]) => runRuns({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...args], cwd: project.root });
  const records = () => readdirSync(join(project.root, "kit/runs")).sort();
  const written = (name: string) => statSync(join(project.root, "kit/runs", name)).mtimeMs;
  try {
    project.write({
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, types: ["node"] },
        include: ["src/**/*.ts", "oracle/**/*.ts"],
      }),
      "src/core/readings/total.ts":
        "export function total(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0); }\n" +
        "export function average(values: readonly number[]): number { return total(values) / values.length; }\n",
      "oracle/sums/total-sums.test.ts": sumsTest,
      "spec/terms.md": "# Terms\n\n- **total** — the sum.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/sums.md": "# Sums\n\nSums.\n\n## Totals\n\n- A total sums its values ({{total}}). · {#total-sums}\n",
      "kit/config.md":
        "```yaml\napp: sums\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nruns:\n  record: kit/runs\n" +
        "  each: node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}\n```\n",
    });
    expect(await runs()).toMatchObject({ exitCode: 0, stderr: "", stdout: expect.stringContaining("recorded 1 tests in kit/runs/") });
    const sums = "oracle+sums+total-sums.test.ts.json";
    expect(records()).toEqual([sums]);
    const record = JSON.parse(readFileSync(join(project.root, "kit/runs", sums), "utf8"));
    expect(record).toMatchObject({ test: "oracle/sums/total-sums.test.ts", ran: { "src/core/readings/total.ts": ["total@1"] } });
    expect(Object.keys(record.digests).sort()).toEqual(["oracle/sums/total-sums.test.ts", "src/core/readings/total.ts"]);

    // A new test is the only record missing, so only it runs.
    project.write({
      "src/core/readings/round.ts": "export function round(value: number): number { return Math.round(value); }\n",
      "oracle/sums/rounds-down.test.ts": roundsTest,
    });
    const before = written(sums);
    expect((await runs("--stale")).stdout).toContain("recorded 1 tests");
    expect(records()).toEqual(["oracle+sums+rounds-down.test.ts.json", sums]);
    expect(written(sums)).toBe(before);

    // An edit reruns only the tests whose records depend on the edited file.
    project.write({ "src/core/readings/round.ts": "export function round(value: number): number { return Math.floor(value + 0.5); }\n" });
    expect((await runs("--stale")).stdout).toContain("recorded 1 tests");
    expect(written(sums)).toBe(before);

    // A named test is recorded again, fresh or not; an unknown one is refused.
    expect((await runs("oracle/sums/total-sums.test.ts")).stdout).toContain("recorded 1 tests");
    expect(written(sums)).not.toBe(before);
    expect(await runs("oracle/sums/missing.test.ts")).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("oracle/sums/missing.test.ts") });

    // A gone test's record is removed when the stale tests are recorded.
    rmSync(join(project.root, "oracle/sums/rounds-down.test.ts"));
    expect((await runs("--stale")).stdout).toContain("removed 1 records of gone tests");
    expect(records()).toEqual([sums]);
  } finally {
    project.dispose();
  }
}, 120_000);

test("raw V8 coverage, which covers the processes a test starts, counts only where it matches the source", () => {
  const text = "export function total(values: number[]): number {\n  return values.length;\n}\nexport const half = (n: number): number => n / 2;\n";
  const v8 = JSON.stringify({
    result: [
      {
        url: "file:///app/src/core/readings/total.ts",
        functions: [
          { functionName: "", ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }] },
          { functionName: "total", ranges: [{ startOffset: 0, endOffset: 60, count: 2 }] },
          { functionName: "half", ranges: [{ startOffset: 3, endOffset: 9, count: 1 }] },
          { functionName: "unused", ranges: [{ startOffset: 0, endOffset: 9, count: 0 }] },
        ],
      },
      { url: "node:internal/main", functions: [] },
    ],
  });
  const files = [
    { path: "src/core/readings/total.ts", type: "source" as const, digest: "a" },
    { path: "oracle/sums/total-sums.test.ts", type: "test" as const, digest: "c" },
  ];
  const functions = [
    { file: "src/core/readings/total.ts", name: "total", line: 1, id: "total", holder: null },
    { file: "src/core/readings/total.ts", name: "half", line: 4, id: "half", holder: null },
  ];
  expect(
    testRuns([{ test: "oracle/sums/total-sums.test.ts", lcov: [], v8: [v8, "not json"] }], files, "/app", { srcRoot: "src" }, new Map(), functions, new Map([["src/core/readings/total.ts", text]]))[0]?.ran,
  ).toEqual({ "src/core/readings/total.ts": ["total@1"] });
});
