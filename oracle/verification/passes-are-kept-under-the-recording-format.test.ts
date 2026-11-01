import { join, relative } from "node:path";
import { afterEach, expect, test } from "vitest";
import { RECORDING_FORMAT, verdictKind } from "../../src/core/readings/verdict-reuse.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const open = (prefix: string): TemporaryProject => {
  const project = temporaryProjects.open(prefix);
  projects.push(project);
  return project;
};

// A Kit outside the app: its own source, which a release changes, and a module a check of the app may load.
function kit(release: string): string {
  const project = open("kit-release-");
  project.write({
    "package.json": JSON.stringify({ name: "kit", type: "module" }),
    "src/tool.mjs": "export const tool = 1;\n",
    "src/release.mjs": `export const release = ${JSON.stringify(release)};\n`,
    "scripts/kit.mjs": "export {};\n",
  });
  return project.root;
}

// An app with a check that reads only its own files, a check that loads the installed Kit's code and a test.
function app() {
  const project = open("kit-format-");
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "kit/config.md":
      "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: node lint.mjs}\n" +
      "    - {id: kit-check, command: node check.mjs}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
    "lint.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
    "check.mjs": 'import { tool } from "kit/src/tool.mjs";\nif (tool !== 1) process.exit(1);\n',
    "data.txt": "1",
    "tests/a.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("a.txt");\n',
    "a.txt": "a",
  });
  const root = project.root;
  // The Kit is installed in the app, as a package link to its own directory.
  const verify = (engineRoot: string, ...flags: string[]) => {
    project.remove("node_modules/kit");
    project.directory("node_modules");
    project.link(engineRoot, "node_modules/kit");
    return runVerify({ engineRoot, args: ["--root", root, "--config", join(root, "kit/config.md"), ...flags], cwd: root });
  };
  return { project, root, verify };
}
const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));
const lines = (stdout: string) => stdout.split("\n").filter((line) => /^(?:passed|reused|failed) /.test(line));

test("two Kit releases under one recording format reuse every pass that did not load Kit's code", async () => {
  const { verify } = app();
  const one = kit("1.0.0");
  const two = kit("1.1.0");
  expect(toolchain.kit(one, "/elsewhere")).not.toBe(toolchain.kit(two, "/elsewhere"));
  const first = await verify(one);
  expect(first.exitCode).toBe(0);
  expect(summary(first.stdout)).toMatchObject({ ran: 3, recorded: 3 });
  const second = await verify(two);
  expect(lines(second.stdout)).toEqual(["passed kit-check", "reused lint", "reused test:tests/a.test.mjs"]);
  expect(summary((await verify(two)).stdout)).toMatchObject({ reused: 3, ran: 0 });
  // Back on the first release, the check that loaded Kit holds the source it ran under then.
  expect(lines((await verify(one)).stdout)).toEqual(["reused kit-check", "reused lint", "reused test:tests/a.test.mjs"]);
}, 120_000);

test("a pass is kept under the recording format, so a pass kept under another format is not reused", async () => {
  const { project, root, verify } = app();
  const one = kit("1.0.0");
  await verify(one);
  const runtime = toolchain.runtime(root);
  const kind = verdictKind("lint", "node lint.mjs", runtime);
  expect(kind).toBe(verdictKind("lint", "node lint.mjs", runtime, RECORDING_FORMAT));
  const store = evidenceStore.directory(root);
  const kept = evidenceStore.entries(store, kind);
  expect(kept).toHaveLength(1);
  // The pass as a Kit with the next format would find it: under the next format's kind alone.
  const next = verdictKind("lint", "node lint.mjs", runtime, RECORDING_FORMAT + 1);
  expect(next).not.toBe(kind);
  for (const [index, text] of kept.entries()) evidenceStore.write(store, next, `${index}`.padStart(64, "0"), text);
  project.remove(relative(root, join(store, kind)));
  expect(lines((await verify(one)).stdout)).toEqual(["passed lint", "reused kit-check", "reused test:tests/a.test.mjs"]);
}, 120_000);

test("a Kit installed among the app's packages is held by the files a run used, not by its release", async () => {
  const project = open("kit-installed-");
  const lock = (version: string) =>
    JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "": { name: "app" }, "node_modules/kit": { version, resolved: `https://registry.example/kit-${version}.tgz` } } });
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "kit/config.md":
      "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: node lint.mjs}\n" +
      "    - {id: kit-check, command: node check.mjs}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
    "package.json": JSON.stringify({ name: "app", type: "module" }),
    "package-lock.json": lock("1.0.0"),
    "lint.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
    "check.mjs": 'import { tool } from "kit/src/tool.mjs";\nif (tool !== 1) process.exit(1);\n',
    "data.txt": "1",
    "tests/a.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("a.txt");\n',
    "a.txt": "a",
    // The Kit running the gate, installed in the app: a file the check loads, and one nothing loads.
    "node_modules/kit/package.json": JSON.stringify({ name: "kit", type: "module" }),
    "node_modules/kit/src/tool.mjs": "export const tool = 1;\n",
    "node_modules/kit/src/other.mjs": "export const other = 1;\n",
  });
  const root = project.root;
  const engineRoot = join(root, "node_modules/kit");
  const verify = (...flags: string[]) => runVerify({ engineRoot, args: ["--root", root, "--config", join(root, "kit/config.md"), ...flags], cwd: root });
  expect(toolchain.kit(engineRoot, root)).toBe("");
  expect((await verify()).exitCode).toBe(0);
  const [pass] = evidenceStore.entries(evidenceStore.directory(root), verdictKind("kit-check", "node check.mjs", toolchain.runtime(root))).map((text) => JSON.parse(text));
  expect(Object.keys(pass.states)).toContain("node_modules/kit/src/tool.mjs");
  expect(Object.keys(pass.states).filter((key) => key === "#kit" || key.startsWith("#package:node_modules/kit"))).toEqual([]);
  // A release that changes only a file no run used, and the lockfile's entry for Kit, reuses every pass.
  project.write({ "node_modules/kit/src/other.mjs": "export const other = 2;\n", "package-lock.json": lock("1.1.0") });
  expect((await verify("--plan")).stdout).toBe("reuse lint\nreuse kit-check\nreuse test:tests/a.test.mjs\n");
  // One that changes a file a check loaded reruns that check alone.
  project.write({ "node_modules/kit/src/tool.mjs": "export const tool = 1; // 1.2.0\n" });
  expect((await verify("--plan")).stdout).toBe("reuse lint\nrun kit-check\nreuse test:tests/a.test.mjs\n");
}, 120_000);
