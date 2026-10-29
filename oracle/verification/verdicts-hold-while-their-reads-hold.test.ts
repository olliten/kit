import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { heldKey, holding, verdictOf } from "../../src/core/readings/verdict-reuse.js";
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

test("a path a check only probed holds while it is the same kind, whatever it holds", async () => {
  const { project, verify } = app();
  project.write({ "tests/c.test.mjs": 'import { existsSync } from "node:fs";\nif (!existsSync("flag.txt")) process.exit(1);\n', "flag.txt": "on" });
  expect(summary((await verify()).stdout)).toMatchObject({ failed: 0 });
  project.write({ "flag.txt": "still on" });
  expect((await verify("--plan")).stdout).toContain("reuse test:tests/c.test.mjs");
  project.remove("flag.txt");
  expect((await verify("--plan")).stdout).toContain("run test:tests/c.test.mjs");
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
  expect(heldKey(one)).not.toBe(heldKey(two));
  expect(holding([one, two], new Map([["data.txt", "file:2"]]))).toBe(two);
  expect(holding([one, two], new Map([["data.txt", "file:3"]]))).toBeUndefined();
  expect(verdictOf(JSON.stringify(one))).toEqual(one);
  expect(verdictOf("{")).toBeNull();
  expect(verdictOf(JSON.stringify({ check: "lint", seconds: 1, states: { a: 1 } }))).toBeNull();
});

test("a check declared after the tests runs once their passes are kept, and is not kept when a test's pass was not", async () => {
  const { project, verify } = app();
  project.write({
    "kit/config.md":
      "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: node lint.mjs}\n    - {id: after, command: node -e 0, after: tests}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
    "tests/c.test.mjs": "process.exit(3);\n",
  });
  const failed = await verify();
  expect(failed.exitCode).toBe(1);
  expect(failed.stdout).toContain("passed after\n");
  expect(summary(failed.stdout)).toMatchObject({ ran: 5, failed: 1, recorded: 3, unrecorded: 1 });
  project.write({ "tests/c.test.mjs": "process.exit(0);\n" });
  expect(summary((await verify()).stdout)).toMatchObject({ reused: 3, ran: 2, failed: 0, recorded: 2 });
  expect(summary((await verify()).stdout)).toMatchObject({ reused: 5, ran: 0 });
}, 120_000);
