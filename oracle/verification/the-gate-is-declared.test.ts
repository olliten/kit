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
    tests: { command: "vitest run {test}", under: "oracle" },
  });
  expect(read({ checks: [] }).verify).toEqual({ checks: [] });
});

test.each([
  [{ checks: [{ id: "a" }] }, /verify\.checks\[0\]/],
  [{ checks: [{ id: "a", command: "x" }, { id: "a", command: "y" }] }, /declared twice/],
  [{ checks: [{ id: "test:a", command: "x" }] }, /test:/],
  [{ checks: [], tests: { command: "vitest run", under: "oracle" } }, /\{test\}/],
  [{ checks: [], tests: { command: "vitest run {test}", under: "../outside" } }, /verify\.tests/],
  [{ checks: [], extra: true }, /verify\.extra is not a key Kit reads/],
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
