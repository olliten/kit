import { join } from "node:path";
import { expect, test } from "vitest";
import { coverageReport } from "../../src/core/readings/coverage-report.js";
import { testRuns } from "../../src/core/readings/test-runs.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
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

test("what a test ran is the named functions of each placed module its report shows it ran", () => {
  const files = [
    { path: "src/core/readings/total.ts", type: "source" as const, digest: "a" },
    { path: "src/core/readings/round.ts", type: "source" as const, digest: "d" },
    { path: "src/core/readings/unused.ts", type: "source" as const, digest: "e" },
    { path: "lib/old.ts", type: "source" as const, digest: "b" },
    { path: "oracle/sums/total-sums.test.ts", type: "test" as const, digest: "c" },
  ];
  expect(testRuns([{ test: "oracle/sums/total-sums.test.ts", lcov: [report], v8: [] }], files, "/app", { srcRoot: "src" })).toEqual([
    { test: "oracle/sums/total-sums.test.ts", ran: { "src/core/readings/total.ts": ["total@1", "visit@9"] } },
  ]);
});

const sumsTest =
  "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../../src/core/readings/total.ts';\n" +
  "test('sums', () => { assert.equal(total([1, 2]), 3); });\n";
const roundsTest =
  "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { round } from '../../src/core/readings/round.ts';\n" +
  "test('rounds', () => { assert.equal(round(1.4), 1); });\n";

test("kit verify keeps what each test ran with its pass, and kit check reads it while every test has a pass that holds", async () => {
  const project = temporaryProjects.open("kit-runs-");
  const config = join(project.root, "kit/config.md");
  const request = (...args: string[]) => ({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...args], cwd: project.root });
  const ungoverned = async () => {
    const report: { readonly findings: readonly { readonly debtKey: string }[] } = JSON.parse((await runCheck(request("--report"))).stdout);
    return report.findings.map((item) => item.debtKey).filter((key) => key.includes("ungoverned-function"));
  };
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
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
        "```yaml\napp: sums\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nverify:\n  checks: []\n  tests:\n    under: oracle/\n" +
        "    command: node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}\n```\n",
    });
    // Before any pass is kept, the rules that read what tests ran wait, and the check says so.
    expect((await runCheck(request())).stdout).toContain("wait for 1 tests");
    expect(await ungoverned()).toEqual([]);

    expect((await runVerify(request())).exitCode).toBe(0);
    expect(await ungoverned()).toEqual([expect.stringContaining("src/core/readings/total.ts")]);
    expect((await runCheck(request())).stdout).not.toContain("wait for");

    // A new test has no kept pass, so the rules wait again until it runs.
    project.write({
      "src/core/readings/round.ts": "export function round(value: number): number { return Math.round(value); }\n",
      "oracle/sums/rounds-down.test.ts": roundsTest,
    });
    expect((await runCheck(request())).stdout).toContain("wait for 1 tests");
    expect(JSON.parse((await runVerify(request())).stdout.split("Kit verify ")[1] ?? "{}")).toMatchObject({ reused: 1, ran: 1, failed: 0 });
    expect((await runCheck(request())).stdout).not.toContain("wait for");

    // An edit to what a test ran makes its pass stop holding.
    project.write({ "src/core/readings/total.ts": "export function total(values: readonly number[]): number { return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value); }\n" });
    expect((await runCheck(request())).stdout).toContain("wait for 1 tests");
  } finally {
    project.dispose();
  }
}, 180_000);

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
    testRuns([{ test: "oracle/sums/total-sums.test.ts", lcov: [], v8: [v8, "not json"] }], files, "/app", { srcRoot: "src" }, functions, new Map([["src/core/readings/total.ts", text]]))[0]?.ran,
  ).toEqual({ "src/core/readings/total.ts": ["total@1"] });
});
