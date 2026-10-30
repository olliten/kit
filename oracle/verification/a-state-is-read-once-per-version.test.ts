import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));

function app(files: Readonly<Record<string, string>>) {
  const project = temporaryProjects.open("kit-once-");
  projects.push(project);
  project.write({ ".git/HEAD": "ref: refs/heads/main\n", "package.json": JSON.stringify({ type: "module" }), ...files });
  const config = join(project.root, "kit/config.md");
  const verify = (...flags: string[]) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root });
  return { project, verify };
}

// Every kept verdict's states, from the store under the project's Git directory.
function keptStates(root: string): Record<string, string>[] {
  const store = join(root, ".git/kit-store/verdicts");
  return readdirSync(store, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".json"))
    .flatMap((path) => verdictOf(readFileSync(join(store, path), "utf8")) ?? [])
    .map((verdict) => verdict.states);
}

test("tests that share files read each file's state once, and a script's code once for the functions they ran", async () => {
  const coverage = "node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
  const shared = (name: string) =>
    `import { test } from "node:test";\nimport { readFileSync } from "node:fs";\nimport { used } from "../lib/m.mjs";\ntest("${name}", () => { if (used() !== 1 || readFileSync("data.txt", "utf8") !== "1") throw new Error("no"); });\n`;
  const { project, verify } = app({
    "kit/config.md": `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n    command: ${coverage}\n    under: tests/\n\`\`\`\n`,
    "lib/m.mjs": "export function used() {\n  return 1;\n}\nexport function unused() {\n  return 2;\n}\n",
    "data.txt": "1",
    "tests/a.test.mjs": shared("a"),
    "tests/b.test.mjs": shared("b"),
    "tests/c.test.mjs": shared("c"),
  });
  expect((await verify()).exitCode).toBe(0);
  // Run again once the fixture is older than any round's start, so every version is trusted.
  const again = summary((await verify("--fresh")).stdout);
  const kept = keptStates(project.root).map((states) => Object.keys(states).filter((key) => !key.endsWith("#kind")));
  expect(kept).toHaveLength(3);
  const distinct = new Set(kept.flat());
  const total = kept.reduce((sum, keys) => sum + keys.length, 0);
  expect(distinct.has("data.txt")).toBe(true);
  expect([...distinct].some((key) => key.startsWith("lib/m.mjs#ran:"))).toBe(true);
  expect(total).toBeGreaterThan(distinct.size);
  expect(again.states).toEqual({ read: distinct.size, reused: total - distinct.size });
}, 120_000);

test("a path one test edits during the run is read again, so a pass known before the run that read it runs", async () => {
  const { project, verify } = app({
    "kit/config.md":
      "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: node lint.mjs, after: tests}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
    "lint.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
    "data.txt": "1",
    "tests/x.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
    "tests/y.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("y.txt");\n',
    "y.txt": "y",
  });
  expect(summary((await verify()).stdout)).toMatchObject({ ran: 3, recorded: 3 });
  // Planning the tests reads data.txt for x's pass; y then changes it, and the check after the tests reads it again.
  project.write({ "tests/y.test.mjs": 'import { readFileSync, writeFileSync } from "node:fs";\nreadFileSync("y.txt");\nwriteFileSync("data.txt", "2");\n' });
  const edited = await verify();
  expect(edited.stdout).toContain("passed lint\n");
  expect(edited.stdout).toContain("reused test:tests/x.test.mjs\n");
  expect((await verify("--plan")).stdout).toContain("run test:tests/x.test.mjs\n");
}, 120_000);
