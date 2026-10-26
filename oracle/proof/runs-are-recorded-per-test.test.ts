import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { coverageReport } from "../../src/core/readings/coverage-report.js";
import { runsRecord } from "../../src/core/readings/runs-record.js";
import { testRuns } from "../../src/core/readings/test-runs.js";
import { runRuns } from "../../src/substrate/compositions/runs-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

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

test("the record holds each placed module's and test's digest, and the named functions each test ran", () => {
  const files = [
    { path: "src/core/readings/total.ts", type: "source" as const, digest: "a" },
    { path: "lib/old.ts", type: "source" as const, digest: "b" },
    { path: "oracle/sums/total-sums.test.ts", type: "test" as const, digest: "c" },
  ];
  expect(testRuns([{ test: "oracle/sums/total-sums.test.ts", texts: [report] }], files, "/app", { srcRoot: "src", oracleRoot: "oracle" })).toEqual({
    digests: { "src/core/readings/total.ts": "a", "oracle/sums/total-sums.test.ts": "c" },
    tests: { "oracle/sums/total-sums.test.ts": { "src/core/readings/total.ts": ["total@1", "visit@9"] } },
  });
});

function recorded(runsText: string | null | undefined, digest = "a"): Snapshot {
  const base = snapshotOf({ files: ["src/core/readings/total.ts", "oracle/sums/total-sums.test.ts"] });
  return {
    ...base,
    config: { ...base.config, runs: { record: "kit/runs.json", each: "run {test} {dir}" } },
    files: base.files.map((file) => ({ ...file, digest: file.type === "test" ? "c" : digest })),
    ...(runsText === undefined ? {} : { runsText }),
  };
}

test("the record is read only while every placed module and test has its recorded digest", () => {
  const record = JSON.stringify({
    digests: { "src/core/readings/total.ts": "a", "oracle/sums/total-sums.test.ts": "c" },
    tests: { "oracle/sums/total-sums.test.ts": { "src/core/readings/total.ts": ["total@1"] } },
  });
  expect(runsRecord(recorded(record)).runs?.tests).toEqual({
    "oracle/sums/total-sums.test.ts": { "src/core/readings/total.ts": ["total@1"] },
  });
  expect(runsRecord(recorded(record, "changed")).findings.map((item) => item.debtKey)).toEqual([
    "R4:runs-stale:kit/runs.json:src/core/readings/total.ts",
  ]);
  expect(runsRecord(recorded(null)).findings.map((item) => item.debtKey)).toEqual(["R4:runs-missing:kit/runs.json"]);
  expect(runsRecord(recorded("{")).findings.map((item) => item.debtKey)).toEqual(["R4:runs-unreadable:kit/runs.json"]);
  const { config, ...rest } = recorded(record);
  const { runs: _, ...undeclared } = config;
  expect(runsRecord({ ...rest, config: undeclared })).toEqual({ runs: null, findings: [] });
});

test("kit runs runs each test file alone with the app's command and records what it ran", async () => {
  const project = temporaryProjects.open("kit-runs-");
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
      "oracle/sums/total-sums.test.ts":
        "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../../src/core/readings/total.ts';\n" +
        "test('sums', () => { assert.equal(total([1, 2]), 3); });\n",
      "spec/terms.md": "# Terms\n\n- **total** — the sum.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/sums.md": "# Sums\n\nSums.\n\n## Totals\n\n- A total sums its values ({{total}}). · {#total-sums}\n",
      "kit/config.md":
        "```yaml\napp: sums\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nruns:\n  record: kit/runs.json\n" +
        "  each: node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}\n```\n",
    });
    const result = await runRuns({
      engineRoot: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md")],
      cwd: project.root,
      input: () => "",
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const { digests, tests } = JSON.parse(readFileSync(join(project.root, "kit/runs.json"), "utf8"));
    expect(tests).toEqual({ "oracle/sums/total-sums.test.ts": { "src/core/readings/total.ts": ["total@1"] } });
    expect(Object.keys(digests).sort()).toEqual(["oracle/sums/total-sums.test.ts", "src/core/readings/total.ts"]);
  } finally {
    project.dispose();
  }
});
