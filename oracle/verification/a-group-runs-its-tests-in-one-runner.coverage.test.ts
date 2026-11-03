import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { verdictKind, verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { testLine } from "../../src/core/readings/verification-configuration.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const primary = "src/core/readings/primary.mjs";
const extraA = "src/core/readings/extra-a.mjs";
const extraB = "src/core/readings/extra-b.mjs";
const chunk = "src/core/readings/chunk.mjs";
const foreign = "src/core/readings/foreign.mjs";
const command = (mode: string) => `node runner.mjs ${mode} {dir} {provider} {tests}`;
const config = (mode: string) =>
  `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n    command: ${command(mode)}\n    under: tests/\n\`\`\`\n`;

// The real provider supplies Node coverage. Auxiliary LCOV is a producer-protocol fixture, not a browser proof.
const runner = [
  'import { spawnSync } from "node:child_process";',
  'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'const [mode, directory, provider, ...tests] = process.argv.slice(2);',
  'const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run",',
  '  "--pool=forks", "--poolOptions.forks.isolate=true", "--poolOptions.forks.maxForks=1", "--poolOptions.forks.minForks=1",',
  '  ...tests, "--coverage.enabled", "--coverage.all=false", "--coverage.provider=custom",',
  '  `--coverage.customProviderModule=${provider}`, "--coverage.reporter=lcovonly",',
  '  "--coverage.reportOnFailure", `--coverage.reportsDirectory=${directory}`], { encoding: "utf8" });',
  'if (result.status !== 0) { process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? ""); process.exit(result.status ?? 1); }',
  'const lcov = (file, functions) => {',
  '  readFileSync(file, "utf8");',
  '  return ["TN:", `SF:${file}`, ...functions.map(([name, line]) => `FN:${line},${name}`),',
  '    ...functions.map(([name, , count]) => `FNDA:${count},${name}`), "end_of_record", ""].join("\\n");',
  '};',
  'if (mode === "multiple") {',
  '  for (const test of tests) {',
  '    const own = join(directory, encodeURIComponent(test));',
  '    const a = test === "tests/a.test.ts";',
  '    const file = a ? "src/core/readings/extra-a.mjs" : "src/core/readings/extra-b.mjs";',
  '    const functions = a ? [["extraAlpha", 1, 1], ["unusedAlpha", 4, 0]] : [["extraBeta", 1, 1]];',
  '    writeFileSync(join(own, "external.lcov"), lcov(file, functions));',
  '  }',
  '  writeFileSync(join(directory, "chunk-wide.lcov"), lcov("src/core/readings/chunk.mjs", [["chunkOnly", 1, 1]]));',
  '  const sibling = join(directory, encodeURIComponent("tests/not-selected.test.ts"));',
  '  mkdirSync(sibling, { recursive: true });',
  '  writeFileSync(join(sibling, "external.lcov"), lcov("src/core/readings/foreign.mjs", [["foreignOnly", 1, 1]]));',
  '}',
  '',
].join("\n");

function app() {
  const project = temporaryProjects.open("kit-many-reports-");
  projects.push(project);
  project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, allowJs: true, checkJs: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [] },
      include: ["src/**/*.mjs"],
    }),
    "runner.mjs": runner,
    "kit/config.md": config("multiple"),
    [primary]: "export function alpha() {\n  return 1;\n}\nexport function beta() {\n  return 2;\n}\n",
    [extraA]: "export function extraAlpha() {\n  return 3;\n}\nexport function unusedAlpha() {\n  return 4;\n}\n",
    [extraB]: "export function extraBeta() {\n  return 5;\n}\n",
    [chunk]: "export function chunkOnly() {\n  return 6;\n}\n",
    [foreign]: "export function foreignOnly() {\n  return 7;\n}\n",
    "tests/a.test.ts": 'import { expect, test } from "vitest";\nimport { alpha } from "../src/core/readings/primary.mjs";\ntest("alpha", () => { expect(alpha()).toBe(1); });\n',
    "tests/b.test.ts": 'import { expect, test } from "vitest";\nimport { beta } from "../src/core/readings/primary.mjs";\ntest("beta", () => { expect(beta()).toBe(2); });\n',
  });
  const verify = (...flags: string[]) =>
    runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags], cwd: project.root });
  const ran = (mode: string, test: string) => {
    const line = testLine(command(mode), test);
    const kind = verdictKind(`test:${test}`, line, toolchain.runtime(project.root));
    const [pass] = evidenceStore.entries(evidenceStore.directory(project.root), kind).flatMap((text) => verdictOf(text) ?? []);
    return pass?.ran;
  };
  return { project, verify, ran };
}

test("a batch combines each test's LCOV reports without borrowing sibling or chunk-wide execution", async () => {
  const { project, verify, ran } = app();
  const result = await verify();
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  expect(ran("multiple", "tests/a.test.ts")).toEqual({ [primary]: ["alpha@1"], [extraA]: ["extraAlpha@1"] });
  expect(ran("multiple", "tests/b.test.ts")).toEqual({ [primary]: ["beta@4"], [extraB]: ["extraBeta@1"] });
  const initial = await verify("--plan");
  expect(initial.stdout).toBe("reuse test:tests/a.test.ts\nreuse test:tests/b.test.ts\n");

  project.write({ [extraA]: "export function extraAlpha() {\n  return 1 + 2;\n}\nexport function unusedAlpha() {\n  return 4;\n}\n" });
  const changed = await verify("--plan");
  expect(changed.stdout).toContain("run test:tests/a.test.ts\n");
}, 180_000);

test("ordinary single-report batch evidence remains unchanged", async () => {
  const { project, verify, ran } = app();
  project.write({ "kit/config.md": config("single") });
  const result = await verify();
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  expect(ran("single", "tests/a.test.ts")).toEqual({ [primary]: ["alpha@1"] });
  expect(ran("single", "tests/b.test.ts")).toEqual({ [primary]: ["beta@4"] });
}, 180_000);
