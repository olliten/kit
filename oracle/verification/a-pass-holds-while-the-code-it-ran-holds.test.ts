import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { functionsRun, ranText } from "../../src/core/readings/ran-code.js";
import { compilerWorkspace } from "../../src/substrate/adapters/compiler.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const module = (used: string, unused: string, top = "3", extra = "") =>
  `export function used() {\n  return ${used};\n}\nexport function unused() {\n  return ${unused};\n}\nexport const top = ${top};\n${extra}`;

test("a pass holds while the functions its test ran hold, whatever happens in functions it never ran", async () => {
  const project = temporaryProjects.open("kit-ran-");
  projects.push(project);
  const coverage = "node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "kit/config.md": `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n    command: ${coverage}\n    under: tests/\n\`\`\`\n`,
    "lib/m.mjs": module("1", "2"),
    "tests/runs.test.mjs":
      'import { test } from "node:test";\nimport { used } from "../lib/m.mjs";\ntest("runs", () => { if (used() !== 1) throw new Error("no"); });\n',
    // A test that reads the module as text depends on all of it.
    "tests/reads.test.mjs":
      'import { test } from "node:test";\nimport { readFileSync } from "node:fs";\nimport { used } from "../lib/m.mjs";\ntest("reads", () => { if (!readFileSync("lib/m.mjs", "utf8").includes("used") || used() !== 1) throw new Error("no"); });\n',
  });
  const config = join(project.root, "kit/config.md");
  const verify = (...flags: string[]) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root });
  const planned = async () => (await verify("--plan")).stdout;
  expect((await verify()).exitCode).toBe(0);
  expect(await planned()).toBe("reuse test:tests/reads.test.mjs\nreuse test:tests/runs.test.mjs\n");

  project.write({ "lib/m.mjs": module("1", "20") });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nreuse test:tests/runs.test.mjs\n");
  project.write({ "lib/m.mjs": module("0 + 1", "20") });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nrun test:tests/runs.test.mjs\n");
  project.write({ "lib/m.mjs": module("1", "20", "4") });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nrun test:tests/runs.test.mjs\n");
  project.write({ "lib/m.mjs": module("1", "20", "3", "export function more() {\n  return 5;\n}\n") });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nrun test:tests/runs.test.mjs\n");
}, 120_000);

test("a function counts as run when a function the coverage shows ran starts inside it, and only unrun bodies are left out", () => {
  const text = [
    "export function outer() {",
    "  const inner = () => 1;",
    "  return inner();",
    "}",
    "export class Box {",
    "  get size(): number {",
    "    return 2;",
    "  }",
    "  open() {",
    "    return 3;",
    "  }",
    "}",
    "export const arrow = (n: number) => n * 2;",
    "",
  ].join("\n");
  const spans = compilerWorkspace.outermostFunctions("box.ts", text);
  expect(spans.map((span) => span.lines)).toEqual([[1, 4], [6, 8], [9, 11], [13, 13]]);
  expect(functionsRun(spans, [2, 9])).toEqual([0, 2]);
  expect(ranText(text, spans, [0, 2])).toBe(
    [
      "export function outer() {",
      "  const inner = () => 1;",
      "  return inner();",
      "}",
      "export class Box {",
      "  get size(): number {}",
      "  open() {",
      "    return 3;",
      "  }",
      "}",
      "export const arrow = (n: number) => {};",
      "",
    ].join("\n"),
  );
});
