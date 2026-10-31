import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { verdictKind, verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { testLine } from "../../src/core/readings/verification-configuration.js";
import { coverageProvider } from "../../src/substrate/adapters/coverage-provider.mjs";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { readRecorder } from "../../src/substrate/adapters/read-recorder.mjs";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const COVERAGE = "--coverage.enabled --coverage.all=false --coverage.reporter=lcovonly --coverage.reportOnFailure --coverage.reportsDirectory={dir}";
const VITEST = "node node_modules/vitest/vitest.mjs run --pool=forks --poolOptions.forks.isolate=true";
const BATCHED = `${VITEST} {tests} --coverage.provider=custom --coverage.customProviderModule={provider} ${COVERAGE}`;
const ALONE = `${VITEST} {test} --coverage.provider=v8 ${COVERAGE}`;
const config = (command: string) =>
  `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n    command: ${command}\n    under: tests/\n\`\`\`\n`;
const module = (alpha = "1", beta = "2") => `export function alpha() {\n  return ${alpha};\n}\nexport function beta() {\n  return ${beta};\n}\n`;
const shared = (g = "2") => `export function f() {\n  return 1;\n}\nexport function g() {\n  return ${g};\n}\n`;

function app() {
  const project = temporaryProjects.open("kit-batch-");
  projects.push(project);
  project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "kit/batched.md": config(BATCHED),
    "kit/alone.md": config(ALONE),
    "lib/m.ts": module(),
    "lib/shared.mjs": shared(),
    "lib/child.mjs": 'import { g } from "./shared.mjs";\nif (g() !== 2) process.exit(1);\n',
    "data/a.txt": "a",
    "data/b.txt": "b",
    "data/c.txt": "no",
    "tests/a.test.ts":
      'import { readFileSync } from "node:fs";\nimport { expect, test } from "vitest";\nimport { alpha } from "../lib/m.ts";\ntest("a", () => { expect(alpha()).toBe(1); expect(readFileSync("data/a.txt", "utf8")).toBe("a"); });\n',
    "tests/b.test.ts":
      'import { readFileSync } from "node:fs";\nimport { expect, test } from "vitest";\nimport { beta } from "../lib/m.ts";\ntest("b", () => { expect(beta()).toBe(2); expect(readFileSync("data/b.txt", "utf8")).toBe("b"); });\n',
    "tests/c.test.ts":
      'import { readFileSync } from "node:fs";\nimport { expect, test } from "vitest";\ntest("c", () => { expect(readFileSync("data/c.txt", "utf8")).toBe("ok"); });\n',
    // A test whose process starts another, which runs a function of a file the test's own code ran only in part.
    "tests/d.test.ts":
      'import { execFileSync } from "node:child_process";\nimport { expect, test } from "vitest";\nimport { f } from "../lib/shared.mjs";\ntest("d", () => { expect(f()).toBe(1); execFileSync(process.execPath, ["lib/child.mjs"]); });\n',
    // A test that runs another test file too, so its coverage can't be told apart from that test's.
    "tests/e.test.ts": 'import "./a.test.ts";\n',
  });
  const verify = (name: string, ...flags: string[]) =>
    runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", join(project.root, `kit/${name}.md`), ...flags], cwd: project.root });
  const planned = async (name = "batched") =>
    (await verify(name, "--plan")).stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/ test:tests\/(.)\.test\.ts$/, " $1"))
      .join(" ");
  // The paths a test's kept pass holds by content or by the functions it ran, under a group's command.
  const kept = (command: string, name: string): string[] => {
    const store = evidenceStore.directory(project.root);
    const kind = verdictKind(`test:tests/${name}.test.ts`, testLine(command, `tests/${name}.test.ts`), toolchain.runtime(project.root));
    const [pass] = evidenceStore.entries(store, kind).flatMap((text) => verdictOf(text) ?? []);
    return Object.keys(pass?.states ?? {}).filter((path) => !path.endsWith("#kind")).sort();
  };
  return { project, verify, planned, kept };
}
const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));

test("a batch keeps each test's pass with only its own reads and the code it ran, and a failure alone fails", async () => {
  const { project, verify, planned, kept } = app();
  const first = await verify("batched");
  expect(first.exitCode).toBe(1);
  expect(first.stdout).toContain("failed test:tests/c.test.ts\n");
  // The test whose coverage holds another test's ran again alone.
  expect(summary(first.stdout)).toMatchObject({ ran: 5, failed: 1, recorded: 4, alone: 1 });
  expect(await planned()).toBe("reuse a reuse b run c reuse d reuse e");
  expect(kept(BATCHED, "a")).toEqual(["data/a.txt", "lib/m.ts#ran:0", "package.json", "tests/a.test.ts"]);
  expect(kept(BATCHED, "b")).toEqual(["data/b.txt", "lib/m.ts#ran:1", "package.json", "tests/b.test.ts"]);

  project.write({ "data/b.txt": "b!" });
  expect(await planned()).toBe("reuse a run b run c reuse d reuse e");
  project.write({ "data/b.txt": "b", "lib/m.ts": module("1", "1 + 1") });
  expect(await planned()).toBe("reuse a run b run c reuse d reuse e");
  project.write({ "lib/m.ts": module("0 + 1") });
  expect(await planned()).toBe("run a reuse b run c reuse d run e");
  project.write({ "lib/m.ts": module() });
  // The function only the started process ran is part of the test's pass.
  project.write({ "lib/shared.mjs": shared("1 + 1") });
  expect(await planned()).toBe("reuse a reuse b run c run d reuse e");
  project.write({ "lib/shared.mjs": shared(), "data/c.txt": "ok" });
  const fixed = await verify("batched");
  expect(fixed.exitCode).toBe(0);
  expect(summary(fixed.stdout)).toMatchObject({ reused: 4, ran: 1, recorded: 1 });
}, 240_000);

test("a test run in a batch keeps what it keeps when its file runs alone", async () => {
  const { project, verify, kept } = app();
  project.write({ "data/c.txt": "ok" });
  expect((await verify("batched")).exitCode).toBe(0);
  expect((await verify("alone")).exitCode).toBe(0);
  for (const name of ["a", "b", "c", "d"]) expect(kept(BATCHED, name)).toEqual(kept(ALONE, name));
}, 240_000);

test("the provider writes each test file's result, coverage and executed scripts apart", async () => {
  const project = temporaryProjects.open("kit-provider-");
  projects.push(project);
  const text = "export function f() {\n  return 1;\n}\nexport function g() {\n  return 2;\n}\n";
  project.write({ "lib/m.mjs": text, "tests/a.test.mjs": "", "tests/b.test.mjs": "", "tests/c.test.mjs": "" });
  const root = project.root;
  const url = (path: string) => `file://${root}/${path}`;
  const at = (name: string) => text.indexOf(`function ${name}`);
  // A blob of raw V8 coverage, as a test file's process gives it: the scripts it executed and their functions.
  const blob = (ran: string, ...tests: string[]) => ({
    result: [
      {
        scriptId: "1",
        url: url("lib/m.mjs"),
        functions: [
          { functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }] },
          ...["f", "g"].map((name) => ({
            functionName: name,
            isBlockCoverage: true,
            ranges: [{ startOffset: at(name), endOffset: text.indexOf("}", at(name)) + 1, count: name === ran ? 1 : 0 }],
          })),
        ],
      },
      ...tests.map((test, index) => ({ scriptId: `${index + 2}`, url: url(test), functions: [] })),
    ],
  });
  const reports = join(root, "reports");
  const provider = await coverageProvider.getProvider();
  provider.initialize({
    config: { root, watch: false, coverage: { enabled: true, all: false, reporter: ["lcovonly"], reportsDirectory: reports, reportOnFailure: true } },
    state: {
      getFiles: () => [
        { filepath: `${root}/tests/a.test.mjs`, result: { state: "pass" } },
        { filepath: `${root}/tests/b.test.mjs`, result: { state: "fail" } },
        { filepath: `${root}/tests/c.test.mjs` },
      ],
      getUnhandledErrors: () => [],
    },
    projects: [],
    vitenode: { fetchCache: new Map(), fetchCaches: { ssr: new Map(), web: new Map() }, transformRequest: async () => null },
    logger: { log: () => undefined },
  });
  provider.onAfterSuiteRun({ coverage: blob("f", "tests/a.test.mjs"), transformMode: "ssr", projectName: "" });
  provider.onAfterSuiteRun({ coverage: blob("g", "tests/b.test.mjs"), transformMode: "ssr", projectName: "" });
  // A file whose coverage holds another test file too can't be told apart.
  provider.onAfterSuiteRun({ coverage: blob("f", "tests/c.test.mjs", "tests/a.test.mjs"), transformMode: "ssr", projectName: "" });
  await provider.reportCoverage({ allTestsRun: true });
  const written = (test: string, file: string) => {
    const path = join(reports, encodeURIComponent(test), file);
    return textFiles.exists(path) ? textFiles.read(path) : undefined;
  };
  expect(JSON.parse(textFiles.read(join(reports, "batch.json")))).toEqual({ errors: 0 });
  expect(JSON.parse(written("tests/a.test.mjs", "run.json") ?? "")).toEqual({
    test: "tests/a.test.mjs",
    state: "pass",
    scripts: [`${root}/lib/m.mjs`, `${root}/tests/a.test.mjs`],
  });
  expect(written("tests/a.test.mjs", "lcov.info")).toMatch(/SF:lib\/m\.mjs[\s\S]*FNDA:1,f\nFNDA:0,g\n/);
  expect(JSON.parse(written("tests/b.test.mjs", "run.json") ?? "")).toMatchObject({ state: "fail" });
  expect(written("tests/b.test.mjs", "lcov.info")).toMatch(/FNDA:0,f\nFNDA:1,g\n/);
  expect(JSON.parse(written("tests/c.test.mjs", "run.json") ?? "")).toEqual({ test: "tests/c.test.mjs", state: null, scripts: null });
  expect(written("tests/c.test.mjs", "lcov.info")).toBeUndefined();
});

test("a process the runner starts names the one test it was sent, and a process it starts names it too", async () => {
  const project = temporaryProjects.open("kit-names-");
  projects.push(project);
  project.write({
    "tests.txt": "tests/a.test.mjs\ntests/b.test.mjs\n",
    "data.txt": "1",
    "more.txt": "2",
    // The runner sends its process the files it runs, beside a configured list of every test.
    "runner.mjs": [
      'import { fork } from "node:child_process";',
      "const [reads, recorder, ...files] = process.argv.slice(2);",
      "const root = process.cwd();",
      "const env = { ...process.env, KIT_READS: reads, KIT_ROOT: root, KIT_TESTS: `${root}/tests.txt`, KIT_TEST: \"\", NODE_OPTIONS: `--import ${recorder}` };",
      'const child = fork("worker.mjs", { env });',
      "child.send({ config: { include: [`${root}/tests/b.test.mjs`] }, task: { files: files.map((file) => `${root}/${file}`) } });",
      'child.on("exit", (code) => process.exit(code ?? 1));',
      "",
    ].join("\n"),
    "worker.mjs": [
      'import { execFileSync } from "node:child_process";',
      'import { readFileSync } from "node:fs";',
      'process.on("message", () => {',
      '  readFileSync("data.txt");',
      '  execFileSync(process.execPath, ["-e", \'require("node:fs").readFileSync("more.txt")\']);',
      "  process.exit(0);",
      "});",
      "",
    ].join("\n"),
  });
  const recorded = async (...files: string[]) => {
    const reads = join(project.root, `reads-${files.length}`);
    project.directory(`reads-${files.length}`);
    const [result] = await processes.shells([{ line: `node runner.mjs ${reads} ${readRecorder.location} ${files.join(" ")}`, env: {} }], project.root);
    expect(result?.status).toBe(0);
    return textFiles
      .entries(reads)
      .map((entry) => textFiles.read(join(reads, entry.name)).split("\n").filter(Boolean).sort().join(" "))
      .sort();
  };
  expect(await recorded("tests/a.test.mjs")).toEqual(["load worker.mjs read data.txt test tests/a.test.mjs", "read more.txt under tests/a.test.mjs"]);
  // A process sent two tests names both, so neither keeps its reads.
  expect((await recorded("tests/a.test.mjs", "tests/b.test.mjs"))[0]).toBe("load worker.mjs read data.txt test tests/a.test.mjs test tests/b.test.mjs");
});
