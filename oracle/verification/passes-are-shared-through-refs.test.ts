import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { sharedPass, sharedPath, sharedRefs, unshared } from "../../src/core/readings/shared-passes.js";
import { heldKey, verdictKind } from "../../src/core/readings/verdict-reuse.js";
import { calendar } from "../../src/substrate/adapters/calendar.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { gitRefs } from "../../src/substrate/adapters/git-refs.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { publishPasses, readSharedPasses } from "../../src/substrate/compositions/pass-sharing.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const PREFIX = "refs/kit-passes";
const APP = {
  "kit/config.md": `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  share: ${PREFIX}/\n  checks:\n    - {id: lint, command: node lint.mjs}\n  tests:\n    command: node {test}\n    under: tests/\n\`\`\`\n`,
  "lint.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
  "data.txt": "1",
  "tests/a.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("a.txt");\n',
  "a.txt": "a",
  "tests/b.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("b.txt");\n',
  "b.txt": "b",
};

function git(cwd: string, ...args: string[]): string {
  const result = processes.run("git", args, cwd);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

// A bare repository as `origin` and lanes cloned beside it, each its own Git directory and so its own store.
function remote(): { origin: string; lane: (name: string, linked?: boolean) => Lane } {
  const project = temporaryProjects.open("kit-share-");
  projects.push(project);
  const origin = join(project.root, "origin.git");
  git(project.root, "init", "--quiet", "--bare", origin);
  return {
    origin,
    lane(name, linked = true) {
      project.write(Object.fromEntries(Object.entries(APP).map(([path, text]) => [`${name}/${path}`, text])));
      const root = join(project.root, name);
      git(root, "init", "--quiet");
      git(root, "config", "user.name", "Kit Test");
      git(root, "config", "user.email", "kit@example.com");
      if (linked) git(root, "remote", "add", "origin", origin);
      const config = join(root, "kit/config.md");
      return {
        root,
        write: (files) => project.write(Object.fromEntries(Object.entries(files).map(([path, text]) => [`${name}/${path}`, text]))),
        verify: (...flags) => runVerify({ engineRoot: root, args: ["--root", root, "--config", config, ...flags], cwd: root }),
      };
    },
  };
}
type Lane = {
  readonly root: string;
  write(files: Readonly<Record<string, string>>): void;
  verify(...flags: string[]): ReturnType<typeof runVerify>;
};

const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));
const refsOf = (root: string) => sharedRefs(PREFIX, toolchain.runtime(root), calendar.now());
const treeOf = (origin: string, ref: string): string[] => git(origin, "ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean);
const tipOf = (origin: string, ref: string): string => git(origin, "for-each-ref", "--format=%(objectname)", ref);

test("one ref per runtime and day, today's then yesterday's, and only a pass kept under its own key counts", () => {
  const runtime = "0123456789abcdef".repeat(4);
  expect(sharedRefs(PREFIX, runtime, Date.UTC(2026, 9, 29, 0, 30))).toEqual([
    `${PREFIX}/2026-10-29-0123456789abcdef`,
    `${PREFIX}/2026-10-28-0123456789abcdef`,
  ]);
  const pass = { check: "lint", seconds: 1, states: { "data.txt": "file:1" } };
  const kind = verdictKind("lint", "node lint.mjs", runtime);
  const path = sharedPath(kind, heldKey(pass));
  expect(path).toBe(`${kind}/${heldKey(pass)}.json`);
  expect(sharedPass(path, JSON.stringify(pass))).toEqual({ kind, key: heldKey(pass) });
  expect(sharedPass(path, JSON.stringify({ ...pass, states: { "data.txt": "file:2" } }))).toBeNull();
  expect(sharedPass(path, "{")).toBeNull();
  expect(sharedPass("README.md", JSON.stringify(pass))).toBeNull();
  expect(unshared([path], [{ path, text: "theirs" }, { path: "b", text: "1" }, { path: "b", text: "2" }])).toEqual([{ path: "b", text: "2" }]);
});

test("a lane publishes its passes and another lane reuses them without running", async () => {
  const { origin, lane } = remote();
  const one = lane("one");
  const first = await one.verify();
  expect(first.exitCode).toBe(0);
  expect(summary(first.stdout)).toMatchObject({ ran: 3, recorded: 3, shared: { read: 0, published: 3 } });
  const [today] = refsOf(one.root);
  expect(treeOf(origin, today)).toHaveLength(3);
  expect(treeOf(origin, today).every((path) => /^verdicts\/[0-9a-f]{64}\/[0-9a-f]{64}\.json$/.test(path))).toBe(true);

  const two = lane("two");
  expect((await two.verify("--plan")).stdout).toBe("reuse lint\nreuse test:tests/a.test.mjs\nreuse test:tests/b.test.mjs\n");
  // The clone's copy of an earlier day's ref is removed by the next reading.
  const stale = `refs/kit-shared/${PREFIX.slice(5)}/2000-01-01-0123456789abcdef`;
  git(two.root, "update-ref", stale, tipOf(origin, today));
  const second = await two.verify();
  expect(summary(second.stdout)).toMatchObject({ reused: 3, ran: 0, shared: { read: 0, published: 0 } });
  expect(git(two.root, "for-each-ref", "--format=%(refname)", "refs/kit-shared/")).toBe(`refs/kit-shared/${today.slice(5)}`);
  two.write({ "data.txt": "2" });
  expect(summary((await two.verify()).stdout)).toMatchObject({ reused: 2, ran: 1, shared: { published: 1 } });
  expect(treeOf(origin, today)).toHaveLength(4);
}, 120_000);

test("yesterday's passes are read and carried into today's ref", async () => {
  const { origin, lane } = remote();
  const one = lane("one");
  await one.verify();
  const [today, yesterday] = refsOf(one.root);
  git(origin, "update-ref", yesterday, tipOf(origin, today));
  git(origin, "update-ref", "-d", today);
  const two = lane("two");
  expect(summary((await two.verify()).stdout)).toMatchObject({ reused: 3, ran: 0, shared: { read: 3, published: 3 } });
  expect(treeOf(origin, today)).toEqual(treeOf(origin, yesterday));
}, 120_000);

test("a push that loses the race reads the moved tip and adds on top, keeping both lanes' passes", async () => {
  const { origin, lane } = remote();
  const one = lane("one");
  const two = lane("two");
  await one.verify();
  const [today] = refsOf(one.root);
  const stale = tipOf(origin, today);
  const seen = readSharedPasses(two.root, evidenceStore.directory(two.root), [today]);
  expect(seen).toMatchObject({ read: 3, tip: stale });
  one.write({ "b.txt": "b2" });
  await one.verify();
  const moved = tipOf(origin, today);
  expect(moved).not.toBe(stale);

  const pass = { check: "lint", seconds: 1, states: { "data.txt": "file:lane-two" } };
  const mine = { path: sharedPath(verdictKind("lint", "node lint.mjs", toolchain.runtime(two.root)), heldKey(pass)), text: JSON.stringify(pass) };
  expect(gitRefs.advance(two.root, today, stale, [mine], "stale\n")).toBeNull();
  if ("failure" in seen) throw new Error(seen.failure);
  expect(publishPasses(two.root, today, [mine], seen)).toEqual({ published: 1 });
  expect(treeOf(origin, today)).toHaveLength(5);
  expect(git(origin, "rev-parse", `${today}^`)).toBe(moved);
}, 120_000);

test("without an origin, or with a push refused for another reason, the gate still passes and says so", async () => {
  const { origin, lane } = remote();
  const alone = lane("alone", false);
  const isolated = await alone.verify();
  expect(isolated.exitCode).toBe(0);
  expect(isolated.stdout).toMatch(/\nShared no passes: git ls-remote: .+\n/);
  expect(summary(isolated.stdout)).toMatchObject({ ran: 3, recorded: 3, shared: { read: 0, published: 0 } });

  const refused = lane("refused");
  const hook = join(origin, "hooks/pre-receive");
  processes.run("sh", ["-c", `printf '#!/bin/sh\\necho closed >&2\\nexit 1\\n' > '${hook}' && chmod +x '${hook}'`]);
  const declined = await refused.verify();
  expect(declined.exitCode).toBe(0);
  expect(declined.stdout).toMatch(/\nPublished no passes: git push: .+\n/);
  expect(summary(declined.stdout)).toMatchObject({ recorded: 3, shared: { published: 0 } });
}, 120_000);

test("--fresh and --no-share neither read nor publish, and --plan reads without publishing", async () => {
  const { origin, lane } = remote();
  const one = lane("one");
  const [today] = refsOf(one.root);
  expect(summary((await one.verify("--no-share")).stdout)).toMatchObject({ recorded: 3, shared: { read: 0, published: 0 } });
  expect(summary((await one.verify("--fresh")).stdout)).toMatchObject({ ran: 3, shared: { read: 0, published: 0 } });
  await one.verify("--plan");
  expect(git(origin, "for-each-ref", PREFIX)).toBe("");
  await one.verify();
  expect(treeOf(origin, today)).toHaveLength(3);
  const tip = tipOf(origin, today);
  const two = lane("two");
  two.write({ "data.txt": "2" });
  expect(summary((await two.verify("--no-share")).stdout)).toMatchObject({ reused: 0, ran: 3, shared: { read: 0, published: 0 } });
  expect(summary((await two.verify("--fresh")).stdout)).toMatchObject({ ran: 3, shared: { read: 0, published: 0 } });
  expect(tipOf(origin, today)).toBe(tip);
}, 120_000);
