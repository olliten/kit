import { join } from "node:path";
import { expect, test } from "vitest";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const proof = "oracle/sums/sums.test.ts";
const module = "src/core/readings/total.ts";
const command = "node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
const source = "export function total(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0); }\n" +
  "export function average(values: readonly number[]): number { return total(values) / values.length; }\n";
const exercise = (name: string, result: number) =>
  `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${name} } from '../../src/core/readings/total.ts';\n` +
  `test('sums', () => { assert.equal(${name}([1, 2]), ${result}); });\n`;

test("fresh verification gives post-test checks current ephemeral execution rather than old persistent passes", async () => {
  const project = temporaryProjects.open("kit-fresh-evidence-");
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        noEmit: true, allowImportingTsExtensions: true, types: [],
      }, include: ["src/**/*.ts"] }),
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: inspect, command: 'node inspect.mjs {evidence}', after: tests}\n  tests:\n" +
        `    command: ${command}\n    under: oracle/\n\`\`\`\n`,
      [module]: source,
      [proof]: exercise("total", 3),
      "expected.txt": "total@1",
      "inspect.mjs": 'import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n' +
        'const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));\n' +
        `const verdict = evidence.tests[${JSON.stringify(proof)}].verdict;\n` +
        'assert.equal(Object.hasOwn(verdict, "seconds"), false);\n' +
        `assert.ok(verdict.ran[${JSON.stringify(module)}].includes(readFileSync("expected.txt", "utf8")));\n`,
    });
    const request = (...flags: string[]) => ({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags] });
    const first = await runVerify(request());
    expect(first.exitCode, first.stderr).toBe(0);
    project.write({ [proof]: exercise("average", 1.5), "expected.txt": "average@2" });
    const fresh = await runVerify(request("--fresh"));
    expect(fresh.exitCode, fresh.stderr).toBe(0);
    expect(fresh.stdout).toContain("passed inspect");
    expect(JSON.parse(fresh.stdout.split("Kit verify ")[1] ?? "{}")).toMatchObject({
      reused: 0, ran: 2, recorded: 0, unrecorded: 0, invalidated: 0,
    });
  } finally {
    project.dispose();
  }
}, 120_000);

test("supplied evidence is authoritative, rejects stale states, and validates legacy tests outside oracle", async () => {
  const project = temporaryProjects.open("kit-check-invocation-");
  try {
    const legacy = "src/sums.test.ts";
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        noEmit: true, allowImportingTsExtensions: true, types: [],
      }, include: ["src/**/*.ts"] }),
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n" +
        `    command: ${command}\n    under: [oracle/, src/]\n\`\`\`\n`,
      [module]: source,
      [proof]: exercise("total", 3),
      [legacy]: "export {};\n",
      "spec/terms.md": "# Terms\n\n- **total** — the sum.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/sums.md": "# Sums\n\nSums.\n\n## Total\n\n- A total sums values ({{total}}). · {#sums}\n",
    });
    const request = (...flags: string[]) => ({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags] });
    expect((await runVerify(request())).exitCode).toBe(0);
    const report = JSON.parse((await runCheck(request("--report"))).stdout);
    expect(report.findings.map((item: { readonly debtKey: string }) => item.debtKey)).not.toContain(`R4:ungoverned-function:${module}:total`);
    const envelope = { version: 1, root: project.root, runtime: toolchain.runtime(project.root), scripts: toolchain.scripts(project.root), tests: {} };
    project.write({ "evidence.json": JSON.stringify(envelope) });
    const empty = JSON.parse((await runCheck(request("--report", "--evidence", join(project.root, "evidence.json")))).stdout);
    expect(empty.findings.map((item: { readonly debtKey: string }) => item.debtKey)).toContain(`R4:ungoverned-function:${module}:total`);
    project.write({ "evidence.json": JSON.stringify({ ...envelope, tests: { [proof]: {
      command: command.replace("{test}", proof), verdict: { check: `test:${proof}`,
        states: { [module]: "file:obsolete" }, ran: { [module]: ["total@1"] } },
    } } }) });
    const stale = await runCheck(request("--evidence", join(project.root, "evidence.json")));
    expect(stale.exitCode).toBe(2);
    expect(stale.stderr).toContain("inputs changed");
    project.write({ "evidence.json": JSON.stringify({ ...envelope, tests: { [legacy]: {
      command: "node foreign-command.mjs", verdict: { check: `test:${legacy}`, states: {} },
    } } }) });
    const foreign = await runCheck(request("--evidence", join(project.root, "evidence.json")));
    expect(foreign.exitCode).toBe(2);
    expect(foreign.stderr).toContain(legacy);
    expect(foreign.stderr).toContain("command");
  } finally {
    project.dispose();
  }
}, 180_000);

test("complete integration capture cannot make an existing cohesion obligation look paid", async () => {
  const project = temporaryProjects.open("kit-cohesion-evidence-");
  const text = "src/core/readings/text.ts";
  const sums = "oracle/text/sums.test.ts";
  const formats = "oracle/text/formats.test.ts";
  const bootstrap = "src/start.ts";
  const debt = `R4:excerpt-cohesion:${text}:spec%2Ftext.md%3Asums:sum`;
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, types: [],
      }, include: ["src/**/*.ts"] }),
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nbootstraps: [src/start.ts]\nverify:\n  checks: []\n  tests:\n    command: node {test} {dir}\n    under: oracle/\n```\n",
      [text]: "export function sum(value: number): number { return value + 1; }\nexport function format(value: number): string { return String(value); }\n",
      [bootstrap]: "export const application = true;\n",
      [sums]: "export {};\n", [formats]: "export {};\n",
      "spec/terms.md": "# Terms\n\n- **text** — text transformations.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/text.md": "# Text\n\nTransforms values.\n\n## Operations\n\n- Sum transforms values ({{text}}). · {#sums}\n- Format transforms values ({{text}}). · {#formats}\n",
      "baseline.json": "{}", "reference.json": JSON.stringify({ [debt]: null }), "footprint.json": JSON.stringify([text]),
    });
    const currentRuntime = toolchain.runtime(project.root);
    const entry = (test: string, ran: string, loaded: readonly string[]) => ({ command: `node ${test} {dir}`, verdict: {
      check: `test:${test}`, states: {}, ran: { [text]: [ran] },
      execution: { complete: true, runtime: currentRuntime, loaded },
    } });
    project.write({ "evidence.json": JSON.stringify({
      version: 1, root: project.root, runtime: currentRuntime, scripts: toolchain.scripts(project.root),
      tests: { [sums]: entry(sums, "sum@1", [sums, text, bootstrap]), [formats]: entry(formats, "format@2", [formats, text]) },
    }) });
    const request = { engineRoot: project.root, cwd: project.root, args: [
      "--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, "baseline.json"),
      "--baseline-reference", join(project.root, "reference.json"), "--debt-mode", "paydown", "--footprint", join(project.root, "footprint.json"),
      "--evidence", join(project.root, "evidence.json"),
    ] };
    const response = await runCheck({ ...request, args: [...request.args, "--report"] });
    expect(response.exitCode).toBe(0);
    const report = JSON.parse(response.stdout);
    expect(report.policyFailures.map((item: { readonly debtKey: string }) => item.debtKey)).toContain("R4:debt-paydown:kit/debt");
    const rejected = await runCheck(request);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("R4:debt-paydown:kit/debt");
  } finally {
    project.dispose();
  }
}, 120_000);
