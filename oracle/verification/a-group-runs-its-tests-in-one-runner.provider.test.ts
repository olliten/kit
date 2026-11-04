import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { coverageProvider } from "../../src/substrate/adapters/coverage-provider.mjs";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => { for (const project of projects.splice(0)) project.dispose(); });

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
