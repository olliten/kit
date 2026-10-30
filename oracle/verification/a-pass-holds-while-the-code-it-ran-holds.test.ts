import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { functionsRun, ranCode } from "../../src/core/readings/ran-code.js";
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

test("a file a process the test starts also loads is kept whole, since the test's coverage doesn't show what that process ran", async () => {
  const project = temporaryProjects.open("kit-ran-");
  projects.push(project);
  // A runner whose coverage, like an in-process runner's, describes only its own process: the test ran `used`.
  const lcov = (root: string) => `SF:${root}/lib/m.mjs\nFN:1,used\nFN:4,unused\nFNDA:1,used\nFNDA:0,unused\nend_of_record\n`;
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n    command: node runner.mjs {test} {dir}\n    under: tests/\n```\n",
    "runner.mjs": [
      'import { writeFileSync } from "node:fs";',
      'import { resolve } from "node:path";',
      "await import(resolve(process.argv[2]));",
      `writeFileSync(\`\${process.argv[3]}/lcov.info\`, ${JSON.stringify(lcov(project.root))});`,
      "",
    ].join("\n"),
    "lib/m.mjs": module("1", "2"),
    "child.mjs": 'import { unused } from "./lib/m.mjs";\nif (unused() !== 2) process.exit(1);\n',
    "tests/spawns.test.mjs": 'import { execSync } from "node:child_process";\nimport { used } from "../lib/m.mjs";\nif (used() !== 1) process.exit(1);\nexecSync("node child.mjs");\n',
    "tests/alone.test.mjs": 'import { used } from "../lib/m.mjs";\nif (used() !== 1) process.exit(1);\n',
  });
  const config = join(project.root, "kit/config.md");
  const verify = (...flags: string[]) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root });
  expect((await verify()).exitCode).toBe(0);
  expect((await verify("--plan")).stdout).toBe("reuse test:tests/alone.test.mjs\nreuse test:tests/spawns.test.mjs\n");
  project.write({ "lib/m.mjs": module("1", "20") });
  expect((await verify("--plan")).stdout).toBe("reuse test:tests/alone.test.mjs\nrun test:tests/spawns.test.mjs\n");
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
  const kept = ranCode("box.ts", compilerWorkspace.code("box.ts", text), spans, [0, 2]).map((token) => token.text).join(" ");
  expect(kept).toBe(
    "export function outer ( ) { const inner = ( ) => 1 ; return inner ( ) ; } export class Box { get size ( ) : number {} open ( ) { return 3 ; } } export const arrow = ( n : number ) => {} ;",
  );
});

const commented = (note: string, indent = "  ", quoted = "a // b", directive = "@ts-expect-error not a number") =>
  [
    "export function used() {",
    `${indent}// ${note}`,
    `${indent}const s = "${quoted}";`,
    `${indent}// ${directive}`,
    `${indent}return s.length > 0 ? 1 : 0;`,
    "}",
    "export function unused() {",
    "  return 2;",
    "}",
    "",
  ].join("\n");

test("a pass holds while only comments or whitespace change in code its test ran, unless the test reads the file", async () => {
  const project = temporaryProjects.open("kit-ran-");
  projects.push(project);
  const coverage = "node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "kit/config.md": `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n    command: ${coverage}\n    under: tests/\n\`\`\`\n`,
    "lib/m.mjs": commented("one"),
    "tests/runs.test.mjs":
      'import { test } from "node:test";\nimport { used } from "../lib/m.mjs";\ntest("runs", () => { if (used() !== 1) throw new Error("no"); });\n',
    "tests/reads.test.mjs":
      'import { test } from "node:test";\nimport { readFileSync } from "node:fs";\nimport { used } from "../lib/m.mjs";\ntest("reads", () => { if (!readFileSync("lib/m.mjs", "utf8").includes("used") || used() !== 1) throw new Error("no"); });\n',
  });
  const config = join(project.root, "kit/config.md");
  const verify = (...flags: string[]) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root });
  const planned = async () => (await verify("--plan")).stdout;
  expect((await verify()).exitCode).toBe(0);
  expect(await planned()).toBe("reuse test:tests/reads.test.mjs\nreuse test:tests/runs.test.mjs\n");

  // A comment inside the function the test ran: the test that reads the file runs again, the other doesn't.
  project.write({ "lib/m.mjs": commented("uno") });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nreuse test:tests/runs.test.mjs\n");
  project.write({ "lib/m.mjs": `${commented("one", "    ").replace("{\n", "{\n\n")}  \n` });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nreuse test:tests/runs.test.mjs\n");
  // A string's text is code, though it holds what looks like a comment.
  project.write({ "lib/m.mjs": commented("one", "  ", "a // c") });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nrun test:tests/runs.test.mjs\n");
  project.write({ "lib/m.mjs": commented("one", "  ", "a // b", "@ts-expect-error still not a number") });
  expect(await planned()).toBe("run test:tests/reads.test.mjs\nrun test:tests/runs.test.mjs\n");
}, 120_000);

test("a file's code is its tokens and the comments a tool reads, with where a line breaks", () => {
  const text = [
    "#!/usr/bin/env node",
    "/*! license */",
    "// a note",
    "/** @param {number} n */",
    "export const f = (n) => /* why */ n + 1;",
    "export const t = `x // ${f(1)} /* y */`;",
    "export const r = /\\/\\*/g;",
    "export const p = /*#__PURE__*/ g();",
    "//# sourceMappingURL=m.js.map",
    "",
  ].join("\n");
  const spans = compilerWorkspace.outermostFunctions("m.js", text);
  const code = (path: string) => ranCode(path, compilerWorkspace.code(path, text), spans, [0]).map((token) => token.text);
  expect(code("m.js")).toEqual([
    "#!/usr/bin/env node",
    "/*! license */",
    "/** @param {number} n */",
    ..."export const f = ( n ) => n + 1 ;".split(" "),
    ..."export const t =".split(" "),
    "`x // ${",
    ..."f ( 1 )".split(" "),
    "} /* y */`",
    ";",
    ..."export const r =".split(" "),
    "/\\/\\*/g",
    ";",
    ..."export const p =".split(" "),
    "/*#__PURE__*/",
    ..."g ( ) ;".split(" "),
    "//# sourceMappingURL=m.js.map",
  ]);
  // A TypeScript file's types are its code, so its `/**` comments don't count.
  expect(code("m.ts")).not.toContain("/** @param {number} n */");
  // Whether a line breaks before a token can change what the code means, as with `return` and its value.
  const lines = (source: string) => compilerWorkspace.code("r.ts", source).flatMap((token) => (token.comment ? [] : [token.line]));
  expect(lines("return x")).not.toEqual(lines("return /*\n*/ x"));
  expect(lines("return x")).toEqual(lines("return  /* why */  x"));
});
