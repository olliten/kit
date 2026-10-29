import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { holdingVerdict, verdictKey, verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const lint = 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n';
const APP = {
  // A repository, so the store lives in its own Git directory.
  ".git/HEAD": "ref: refs/heads/main\n",
  "kit/config.md":
    "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: node lint.mjs}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
  "lint.mjs": lint,
  "data.txt": "1",
  "lib/a.mjs": "export const a = 1;\n",
  "tests/a.test.mjs": 'import { a } from "../lib/a.mjs";\nif (a !== 1) process.exit(1);\n',
  "tests/b.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("b.txt");\n',
  "b.txt": "b",
};

function app(): { project: TemporaryProject; verify: (...flags: string[]) => ReturnType<typeof runVerify> } {
  const project = temporaryProjects.open("kit-verify-");
  projects.push(project);
  project.write(APP);
  const config = join(project.root, "kit/config.md");
  return {
    project,
    verify: (...flags) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root }),
  };
}
const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));

test("a pass is reused while every path it read holds, and an edit reruns only what read it", async () => {
  const { project, verify } = app();
  expect(summary((await verify()).stdout)).toMatchObject({ ran: 3, failed: 0, recorded: 3 });
  const again = await verify();
  expect(summary(again.stdout)).toMatchObject({ reused: 3, ran: 0 });
  project.write({ "data.txt": "2" });
  expect((await verify("--plan")).stdout).toBe("run lint\nreuse test:tests/a.test.mjs\nreuse test:tests/b.test.mjs\n");
  project.write({ "lib/a.mjs": "export const a = 1; // still one\n" });
  const edited = await verify();
  expect(edited.stdout).toContain("passed lint\npassed test:tests/a.test.mjs\nreused test:tests/b.test.mjs\n");
  expect(summary((await verify("--fresh")).stdout)).toMatchObject({ reused: 0, ran: 3 });
});

test("a failure is never kept, and exits 1", async () => {
  const { project, verify } = app();
  project.write({ "tests/c.test.mjs": "process.exit(3);\n" });
  const failed = await verify();
  expect(failed.exitCode).toBe(1);
  expect(failed.stdout).toContain("failed test:tests/c.test.mjs");
  expect(failed.stderr).toContain("test:tests/c.test.mjs failed:");
  expect((await verify("--plan")).stdout).toContain("run test:tests/c.test.mjs");
});

test("a pass during which a path it read changed is reported and not kept", async () => {
  const { project, verify } = app();
  await verify();
  project.write({ "lint.mjs": 'import { appendFileSync, readFileSync } from "node:fs";\nreadFileSync("data.txt");\nappendFileSync("data.txt", "+");\n' });
  expect(summary((await verify()).stdout)).toMatchObject({ ran: 1, recorded: 0, unrecorded: 1 });
});

test("runs on different trees each keep theirs, and the one whose paths hold is reused", () => {
  const one = { check: "lint", seconds: 1, states: { "data.txt": "file:1" } };
  const two = { check: "lint", seconds: 1, states: { "data.txt": "file:2" } };
  expect(verdictKey(one)).not.toBe(verdictKey(two));
  expect(holdingVerdict([one, two], new Map([["data.txt", "file:2"]]))).toBe(two);
  expect(holdingVerdict([one, two], new Map([["data.txt", "file:3"]]))).toBeUndefined();
  expect(verdictOf(JSON.stringify(one))).toEqual(one);
  expect(verdictOf("{")).toBeNull();
  expect(verdictOf(JSON.stringify({ check: "lint", seconds: 1, states: { a: 1 } }))).toBeNull();
});

test("with runs declared, one run of a test keeps its pass and its runs record, and what reads the records runs after", async () => {
  const project = temporaryProjects.open("kit-verify-runs-");
  projects.push(project);
  const each =
    "node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, types: ["node"] },
      include: ["src/**/*.ts", "oracle/**/*.ts"],
    }),
    "src/core/readings/total.ts": "export function total(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0); }\n",
    "oracle/sums/total-sums.test.ts":
      "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../../src/core/readings/total.ts';\ntest('sums', () => { assert.equal(total([1, 2]), 3); });\n",
    "oracle/sums/records-are-read.test.ts":
      "import { test } from 'node:test';\nimport { readdirSync } from 'node:fs';\ntest('lists', () => { try { readdirSync('kit/runs'); } catch {} });\n",
    "spec/terms.md": "# Terms\n",
    "count-records.mjs": 'import { readdirSync } from "node:fs";\nif (readdirSync("kit/runs").length !== 2) process.exit(1);\n',
    "kit/config.md":
      "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nruns:\n  record: kit/runs\n  each: " +
      each +
      "\nverify:\n  checks:\n    - {id: records, command: node count-records.mjs, after: tests}\n  tests:\n    command: node --test {test}\n    under: oracle/\n```\n",
  });
  const config = join(project.root, "kit/config.md");
  const result = await runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config], cwd: project.root });
  expect(result.exitCode).toBe(0);
  expect(readdirSync(join(project.root, "kit/runs")).sort()).toEqual(["oracle+sums+records-are-read.test.ts.json", "oracle+sums+total-sums.test.ts.json"]);
  // The test that listed the records ran before they were written, so it ran again, after them.
  expect(result.stdout).toContain("passed records\npassed test:oracle/sums/records-are-read.test.ts\npassed test:oracle/sums/total-sums.test.ts\n");
  expect(summary(result.stdout)).toMatchObject({ ran: 3, failed: 0 });
  expect(summary((await runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config], cwd: project.root })).stdout)).toMatchObject({
    reused: 3,
    ran: 0,
  });
}, 120_000);
