import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

// One tree. Its test probes the root inside itself, as Vite's resolver does, and a check after the tests reads
// the invocation's evidence, which names the root.
const TREE = {
  "kit/config.md":
    "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: node lint.mjs}\n" +
    "    - {id: contracts, command: 'node contracts.mjs {evidence}', after: tests}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
  "lint.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
  "contracts.mjs": 'import { readFileSync } from "node:fs";\nconst { root } = JSON.parse(readFileSync(process.argv[2], "utf8"));\nif (root !== process.cwd()) process.exit(1);\n',
  "data.txt": "1",
  "lib/a.mjs": "export const a = 1;\n",
  "tests/a.test.mjs": [
    'import { existsSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { a } from "../lib/a.mjs";',
    "existsSync(join(process.cwd(), process.cwd()));",
    "if (a !== 1) process.exit(1);",
  ].join("\n"),
  "tests/b.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("b.txt");\n',
  "b.txt": "b",
};

const entries = (store: string): string[] => {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name).slice(store.length)]);
  return walk(join(store, "verdicts")).sort();
};
const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));

test("the same tree verified in another folder sharing the store reuses every pass and keeps no new one", async () => {
  const project = temporaryProjects.open("kit-folders-");
  projects.push(project);
  // The repository's own checkout, and a second worktree of it in another folder: its Git directory points into
  // the first's, whose common directory holds the store.
  const first = join(project.root, "checkout");
  const second = join(project.root, "elsewhere/land-1a2b");
  project.write({
    ...Object.fromEntries(Object.entries(TREE).map(([path, text]) => [`checkout/${path}`, text])),
    ...Object.fromEntries(Object.entries(TREE).map(([path, text]) => [`elsewhere/land-1a2b/${path}`, text])),
    "checkout/.git/HEAD": "ref: refs/heads/main\n",
    "checkout/.git/worktrees/land/commondir": "../..\n",
    "elsewhere/land-1a2b/.git": `gitdir: ${first}/.git/worktrees/land\n`,
  });
  const store = evidenceStore.directory(first);
  expect(evidenceStore.directory(second)).toBe(store);
  const verify = (root: string, ...flags: string[]) =>
    runVerify({ engineRoot: root, args: ["--root", root, "--config", join(root, "kit/config.md"), "--no-share", ...flags], cwd: root });

  const initial = await verify(first);
  expect(initial.exitCode, initial.stdout + initial.stderr).toBe(0);
  expect(summary(initial.stdout)).toMatchObject({ ran: 4, failed: 0, recorded: 4 });
  const kept = entries(store);
  expect(kept).toHaveLength(4);

  expect((await verify(second, "--plan")).stdout).toBe(
    "reuse lint\nreuse test:tests/a.test.mjs\nreuse test:tests/b.test.mjs\nreuse contracts\n",
  );
  const elsewhere = await verify(second);
  expect(elsewhere.exitCode, elsewhere.stdout + elsewhere.stderr).toBe(0);
  expect(summary(elsewhere.stdout)).toMatchObject({ reused: 4, ran: 0 });
  expect(entries(store)).toEqual(kept);

  // Reuse is no looser for it: an edit in the second folder reruns what read it there, and the check after the
  // tests, whose evidence changed.
  project.write({ "elsewhere/land-1a2b/lib/a.mjs": "export const a = 1; // still one\n" });
  expect((await verify(second, "--plan")).stdout).toBe(
    "reuse lint\nrun test:tests/a.test.mjs\nreuse test:tests/b.test.mjs\nrun contracts\n",
  );
});
