import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityModules, testGroups } from "../../src/core/readings/test-groups.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const browser = { command: "browser {test}", under: ["oracle"], reaching: ["spec/harness/full-stack"] };
const unit = { command: "unit {test}", under: ["oracle", "src"] };
const imports = [
  { from: "oracle/a.test.ts", to: "spec/harness/full-stack.ts" },
  { from: "oracle/b.test.ts", to: "spec/harness/boot.ts" },
  { from: "spec/harness/boot.ts", to: "spec/harness/full-stack.ts" },
  { from: "oracle/c.test.ts", to: "src/sum.ts" },
  { from: "src/sum.test.ts", to: "spec/harness/full-stack.ts" },
];

test("a test whose imports reach a group's module, directly or through what they import, runs in that group", () => {
  expect(testGroups(["oracle/a.test.ts", "oracle/b.test.ts", "oracle/c.test.ts"], [browser, unit], imports)).toEqual(
    new Map([
      ["oracle/a.test.ts", 0],
      ["oracle/b.test.ts", 0],
      ["oracle/c.test.ts", 1],
    ]),
  );
});

test("the first group whose modules a test reaches takes it, before a later one and before a group naming none", () => {
  const all = { command: "all {test}", under: ["oracle"] };
  const boot = { command: "boot {test}", under: ["oracle"], reaching: ["spec/harness/boot.ts"] };
  expect(testGroups(["oracle/b.test.ts", "oracle/c.test.ts"], [all, boot, browser], imports)).toEqual(
    new Map([
      ["oracle/b.test.ts", 1],
      ["oracle/c.test.ts", 0],
    ]),
  );
});

test("a test only groups whose directories hold it can take, and one no group takes has no group", () => {
  const chosen = testGroups(["src/sum.test.ts", "spec/x.test.ts", "oracle/c.test.ts"], [browser, { ...unit, under: ["src"] }], imports);
  expect(chosen).toEqual(new Map([["src/sum.test.ts", 1]]));
});

const driving = new Map([["browser-driving", ["spec/harness/full-stack.ts"]]]);

test("a group naming a capability takes the tests whose imports reach a module registered with it, directly or through what they import", () => {
  const byCapability = { command: "browser {test}", under: ["oracle"], capabilities: ["browser-driving"] };
  expect(testGroups(["oracle/a.test.ts", "oracle/b.test.ts", "oracle/c.test.ts"], [byCapability, unit], imports, driving)).toEqual(
    new Map([
      ["oracle/a.test.ts", 0],
      ["oracle/b.test.ts", 0],
      ["oracle/c.test.ts", 1],
    ]),
  );
});

test("a group naming both modules and capabilities takes a test that reaches either", () => {
  const both = { command: "both {test}", under: ["oracle"], reaching: ["src/sum"], capabilities: ["browser-driving"] };
  expect(testGroups(["oracle/a.test.ts", "oracle/c.test.ts", "oracle/d.test.ts"], [both, unit], imports, driving)).toEqual(
    new Map([
      ["oracle/a.test.ts", 0],
      ["oracle/c.test.ts", 0],
      ["oracle/d.test.ts", 1],
    ]),
  );
});

test("the first group a test reaches takes it whether it names modules or capabilities, and a group naming either is no fallback", () => {
  const boot = { command: "boot {test}", under: ["oracle"], reaching: ["spec/harness/boot.ts"] };
  const byCapability = { command: "browser {test}", under: ["oracle"], capabilities: ["browser-driving"] };
  const unregistered = { command: "none {test}", under: ["oracle"], capabilities: ["printing"] };
  expect(testGroups(["oracle/a.test.ts", "oracle/b.test.ts", "oracle/c.test.ts"], [unregistered, boot, byCapability, unit], imports, driving)).toEqual(
    new Map([
      ["oracle/a.test.ts", 2],
      ["oracle/b.test.ts", 1],
      ["oracle/c.test.ts", 3],
    ]),
  );
});

test("a capability's modules are the files of the adapters registered with it that a group names", () => {
  const adapter = { export: "driver", kind: "external", zones: ["shell"] };
  const config = configuredKit(DEFAULT_CONFIG, {
    roots: { src: ["src/", "oracle/"], spec: "spec/", oracle: "oracle/" },
    verify: { checks: [], tests: [{ command: "b {test}", under: "oracle", capabilities: ["browser-driving"] }, { command: "u {test}", under: "oracle" }] },
    adapters: [
      { ...adapter, module: "src/shell/adapters/driver", capability: "browser-driving" },
      { ...adapter, module: "oracle/shell/adapters/page.mjs", capability: "browser-driving" },
      { ...adapter, module: "src/shell/adapters/driver", capability: "network" },
    ],
  });
  expect(capabilityModules(config)).toEqual(new Map([["browser-driving", ["src/shell/adapters/driver.ts", "oracle/shell/adapters/page.mjs"]]]));
});

test("a group naming a capability no adapter registers fails configuration naming where", () => {
  const read = () =>
    configuredKit(DEFAULT_CONFIG, {
      roots: { src: "src/", spec: "spec/", oracle: "oracle/" },
      verify: { checks: [], tests: [{ command: "u {test}", under: "oracle" }, { command: "b {test}", under: "oracle", capabilities: ["browser-driving", "printing"] }] },
      adapters: [{ module: "shell/adapters/driver", export: "driver", capability: "browser-driving", kind: "external", zones: ["shell"] }],
    });
  expect(read).toThrow("verify.tests[1].capabilities[1]: no adapter registers the capability printing");
});

const reaches = (helper: string) => `import "../lib/${helper}.mjs";\n`;
const APP = {
  ".git/HEAD": "ref: refs/heads/main\n",
  "kit/config.md":
    "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n" +
    "    - command: node {test} browser\n      under: [tests/, other/]\n      reaching: [lib/browser]\n" +
    "    - command: node {test} unit\n      under: tests/\n```\n",
  // The browser helper fails unless its test runs under the browser group's command.
  "lib/browser.mjs": 'if (process.argv[2] !== "browser") process.exit(1);\n',
  "lib/boot.mjs": 'import "./browser.mjs";\n',
  "lib/sum.mjs": "export const sum = 1;\n",
  "tests/a.test.mjs": reaches("sum"),
  "tests/b.test.mjs": reaches("boot"),
  "other/c.test.mjs": reaches("sum"),
};

test("kit verify runs each test under its group's command, reruns a test that moves group, and names a test no group takes", async () => {
  const project = temporaryProjects.open("kit-groups-");
  projects.push(project);
  project.write(APP);
  const config = join(project.root, "kit/config.md");
  const verify = (...flags: string[]) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root });
  const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));
  expect((await verify("--plan")).stdout).toBe(
    "run test:tests/a.test.mjs in tests[1]\nrun test:tests/b.test.mjs in tests[0]\nunassigned test:other/c.test.mjs\n",
  );
  const first = await verify();
  expect(first.stdout).toContain("passed test:tests/a.test.mjs\npassed test:tests/b.test.mjs\nunassigned test:other/c.test.mjs\n");
  expect(summary(first.stdout)).toMatchObject({ ran: 2, failed: 0, recorded: 2, unassigned: 1 });
  expect(first.exitCode).toBe(1);
  expect(first.stderr).toContain("other/c.test.mjs: no test group takes it, so it never runs.");
  expect(first.exitCode).toBe(1);
  expect(first.stderr).toContain("other/c.test.mjs: no test group takes it, so it never runs.");
  project.write({ "tests/a.test.mjs": reaches("boot") });
  expect((await verify("--plan")).stdout).toContain("run test:tests/a.test.mjs in tests[0]\nreuse test:tests/b.test.mjs in tests[0]\n");
  expect(summary((await verify()).stdout)).toMatchObject({ ran: 1, reused: 1, failed: 0 });
}, 120_000);

const BY_CAPABILITY = {
  ".git/HEAD": "ref: refs/heads/main\n",
  "kit/config.md":
    "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n" +
    "    - command: node {test} browser\n      under: tests/\n      capabilities: [browser-driving]\n" +
    "    - command: node {test} unit\n      under: tests/\n" +
    "adapters:\n  - {module: shell/adapters/browser.mjs, export: browser, capability: browser-driving, kind: external, zones: [shell]}\n```\n",
  // The adapter fails unless its test runs under the browser group's command.
  "src/shell/adapters/browser.mjs": 'if (process.argv[2] !== "browser") process.exit(1);\nexport const browser = {};\n',
  "lib/boot.mjs": 'import "../src/shell/adapters/browser.mjs";\n',
  "lib/sum.mjs": "export const sum = 1;\n",
  "tests/a.test.mjs": reaches("sum"),
  "tests/b.test.mjs": reaches("boot"),
};

test("kit verify moves a test into the group of a capability once its imports come to reach an adapter registered with it", async () => {
  const project = temporaryProjects.open("kit-groups-capability-");
  projects.push(project);
  project.write(BY_CAPABILITY);
  const config = join(project.root, "kit/config.md");
  const verify = (...flags: string[]) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root });
  expect((await verify("--plan")).stdout).toBe("run test:tests/a.test.mjs in tests[1]\nrun test:tests/b.test.mjs in tests[0]\n");
  expect((await verify()).exitCode).toBe(0);
  project.write({ "tests/a.test.mjs": 'import "../src/shell/adapters/browser.mjs";\n' });
  expect((await verify("--plan")).stdout).toBe("run test:tests/a.test.mjs in tests[0]\nreuse test:tests/b.test.mjs in tests[0]\n");
  const moved = await verify();
  expect(moved.exitCode).toBe(0);
  expect(moved.stdout).toContain("passed test:tests/a.test.mjs\n");
}, 120_000);

const sumsTest =
  "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../../src/core/readings/total.ts';\n" +
  "test('sums', () => { assert.equal(total([1, 2]), 3); });\n";
const coverage = "--test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
const configOf = (reaching: string) =>
  "```yaml\napp: sums\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nverify:\n  checks: []\n  tests:\n" +
  `    - command: node --experimental-strip-types --no-warnings --test-timeout=60000 ${coverage}\n      under: oracle/\n      reaching: [${reaching}]\n` +
  `    - command: node --experimental-strip-types --no-warnings ${coverage}\n      under: oracle/\n` +
  "```\n";

test("kit check reads each test's pass under the command of the group its reach selects", async () => {
  const project = temporaryProjects.open("kit-groups-check-");
  projects.push(project);
  const config = join(project.root, "kit/config.md");
  const request = () => ({ engineRoot: project.root, args: ["--root", project.root, "--config", config], cwd: project.root });
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, types: ["node"] },
      include: ["src/**/*.ts", "oracle/**/*.ts"],
    }),
    "src/core/readings/total.ts": "export function total(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0); }\n",
    "oracle/sums/total-sums.test.ts": sumsTest,
    "spec/terms.md": "# Terms\n\n- **total** — the sum.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
    "spec/sums.md": "# Sums\n\nSums.\n\n## Totals\n\n- A total sums its values ({{total}}). · {#total-sums}\n",
    "kit/config.md": configOf("src/core/readings/largest.ts"),
  });
  expect((await runVerify(request())).exitCode).toBe(0);
  expect((await runCheck(request())).stdout).not.toContain("wait for");
  // The test's own reads still hold, but it now runs in the first group, under whose command it has no pass yet.
  project.write({ "kit/config.md": configOf("src/core/readings/total") });
  expect((await runCheck(request())).stdout).toContain("wait for 1 tests");
  expect(JSON.parse((await runVerify(request())).stdout.split("Kit verify ")[1] ?? "{}")).toMatchObject({ ran: 1, reused: 0, failed: 0 });
  expect((await runCheck(request())).stdout).not.toContain("wait for");
}, 180_000);
