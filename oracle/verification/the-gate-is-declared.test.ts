import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
const read = (verify: unknown) => configuredKit(DEFAULT_CONFIG, { roots, verify });
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

test("a gate is whole-tree checks, each an id and a command, and the command that runs one test", () => {
  expect(read({ checks: [{ id: "typecheck", command: "tsc --noEmit" }], tests: { command: "vitest run {test}", under: "oracle/" } }).verify).toEqual({
    checks: [{ id: "typecheck", command: "tsc --noEmit" }],
    tests: [{ command: "vitest run {test}", under: ["oracle"] }],
  });
  expect(read({ checks: [], tests: { command: "vitest run {test}", under: ["spec/", "oracle/", "spec"] } }).verify?.tests?.[0]?.under).toEqual(["oracle", "spec"]);
  expect(read({ checks: [] }).verify).toEqual({ checks: [] });
  expect(read({ checks: [], share: "refs/heads/kit-passes/" }).verify).toEqual({ checks: [], share: "refs/heads/kit-passes" });
});

test("the tests may be a list of groups, each a command, its directories and the modules whose reach selects it", () => {
  const tests = [
    { command: "browser {test}", under: ["oracle/", "spec"], reaching: ["spec/harness/full-stack.ts", "./spec/boot"] },
    { command: "unit {test}", under: "oracle/" },
  ];
  expect(read({ checks: [], tests }).verify?.tests).toEqual([
    { command: "browser {test}", under: ["oracle", "spec"], reaching: ["spec/boot", "spec/harness/full-stack.ts"] },
    { command: "unit {test}", under: ["oracle"] },
  ]);
});

test("a group may name the capabilities of registered adapters whose reach selects it, beside or instead of modules", () => {
  const adapters = [{ module: "shell/adapters/driver", export: "driver", capability: "browser-driving", kind: "external", zones: ["shell"] }];
  const tests = [
    { command: "browser {test}", under: "oracle/", capabilities: ["browser-driving", "browser-driving"], reaching: ["spec/boot"] },
    { command: "driver {test}", under: "oracle/", capabilities: ["browser-driving"] },
    { command: "unit {test}", under: "oracle/" },
  ];
  expect(configuredKit(DEFAULT_CONFIG, { roots, verify: { checks: [], tests }, adapters }).verify?.tests).toEqual([
    { command: "browser {test}", under: ["oracle"], reaching: ["spec/boot"], capabilities: ["browser-driving"] },
    { command: "driver {test}", under: ["oracle"], capabilities: ["browser-driving"] },
    { command: "unit {test}", under: ["oracle"] },
  ]);
});

test.each([
  [{ checks: [{ id: "a" }] }, /verify\.checks\[0\]/],
  [{ checks: [{ id: "a", command: "x" }, { id: "a", command: "y" }] }, /declared twice/],
  [{ checks: [{ id: "test:a", command: "x" }] }, /test:/],
  [{ checks: [], tests: { command: "vitest run", under: "oracle" } }, /\{test\}/],
  [{ checks: [], tests: { command: "vitest run {test}", under: "../outside" } }, /verify\.tests/],
  [{ checks: [], tests: { command: "vitest run {test}", under: ["oracle", "../outside"] } }, /verify\.tests/],
  [{ checks: [], tests: { command: "vitest run {test}", under: [] } }, /verify\.tests/],
  [{ checks: [], extra: true }, /verify\.extra is not a key Kit reads/],
  [{ checks: [], tests: [] }, /verify\.tests: list at least one group/],
  [{ checks: [], tests: [{ command: "unit {test}", under: "oracle" }, { command: "browser", under: "oracle" }] }, /verify\.tests\[1\]: declare the command/],
  [{ checks: [], tests: [{ command: "unit {test}", under: "oracle" }, { command: "b {test}", under: "oracle", reaching: ["../x.ts"] }] }, /verify\.tests\[1\]\.reaching/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", reaching: "spec/boot.ts" }] }, /verify\.tests\[0\]\.reaching/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", reaching: [] }] }, /verify\.tests\[0\]\.reaching/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", reaching: ["/abs/x.ts"] }] }, /verify\.tests\[0\]\.reaching/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", extra: 1 }] }, /verify\.tests\[0\]\.extra is not a key Kit reads/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", capabilities: "browser-driving" }] }, /verify\.tests\[0\]\.capabilities: list/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", capabilities: [] }] }, /verify\.tests\[0\]\.capabilities: list/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", capabilities: ["browser-driving", 7] }] }, /verify\.tests\[0\]\.capabilities: list/],
  [{ checks: [], tests: [{ command: "b {test}", under: "oracle", capabilities: [" "] }] }, /verify\.tests\[0\]\.capabilities: list/],
  [{ checks: [], tests: { command: "b {test}", under: "oracle", capabilities: ["printing"] } }, /verify\.tests\.capabilities\[0\]: no adapter registers the capability printing/],
  [{ checks: [], share: "kit-passes" }, /verify\.share/],
  [{ checks: [], share: "refs/heads/kit..passes" }, /verify\.share/],
  [{ checks: [], share: "refs/heads/kit.lock" }, /verify\.share/],
  [{ checks: [], share: 7 }, /verify\.share/],
])("a malformed gate %j fails configuration", (verify, message) => {
  expect(() => read(verify)).toThrow(message);
});

test("kit verify without a declared gate says what to declare", async () => {
  const project = temporaryProjects.open("kit-gate-");
  projects.push(project);
  project.write({ "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\n```\n" });
  const config = join(project.root, "kit/config.md");
  expect(await runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config], cwd: project.root })).toEqual({
    stdout: "",
    stderr: `Kit config ${config}: declare verify, the gate's checks and tests.\n`,
    exitCode: 2,
  });
});
