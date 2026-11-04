import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import { authoredExample } from "../substrate/compositions/authored-example.js";

const engine = resolve(import.meta.dirname, "../..");
const scratch = temporaryProjects.open("kit-symlink-cli-");
afterAll(() => scratch.dispose());

// Copy authored inputs without reading the example root's changing runtime-output inventory.
const example = join(engine, "examples/tally");
scratch.write(Object.fromEntries(Object.entries(authoredExample(example))
  .map(([path, text]) => [`tally/${path}`, text])));
// The known violation: a module no claim names, planted in the copy of the clean example.
scratch.write({
  "tally/src/substrate/compositions/save.ts": "export function save(text: string): string {\n  return text;\n}\n",
});
scratch.directory("tally/node_modules");
const app = join(scratch.root, "tally");
symlinkSync(engine, join(app, "node_modules/kit"), "dir");
const config = join(app, "kit/config.md");
const baseline = join(app, "kit/debt/legacy.json");

const script = (name: string) => join(app, "node_modules/kit/scripts", name + ".mjs");
function run(name: string, args: readonly string[]) {
  const result = processes.run(processes.node(), [script(name), ...args], app);
  // A status means the program started and exited on its own rather than being killed by a signal.
  expect(result.status).not.toBeNull();
  return result;
}

test("a node_modules symlink runs the real check and fails on the fixture's known violation", () => {
  const result = run("kit-check", ["--root", app, "--config", config, "--baseline", baseline]);
  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(/^Kit check /m);
  expect(result.stderr).toContain("R4:unreferenced-module:substrate/compositions/save:");
}, 120_000);

test("a symlinked refs entrypoint emits the named module's actual claim and oracle", () => {
  const result = run("kit-refs", ["--root", app, "--config", config, "src/core/readings/total.ts"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("core/readings/total keeps 3 claims:");
  expect(result.stdout).toContain("spec/tally.md#total-holds:");
  expect(result.stdout).toContain("oracle/tally/total-holds.test.ts");
  expect(result.stderr).toBe("");
}, 120_000);

test("a symlinked consumers entrypoint actually checks the named app and reports its work", () => {
  const result = run("kit-consumers", [app]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^tally: \d+ failing \(pins no Kit\): /);
  expect(result.stdout).toContain("R4:unreferenced-module:substrate/compositions/save:");
}, 120_000);

test("importing all three symlinked CLI modules remains inert", () => {
  scratch.write({
    "import-only.mjs": ["kit-check", "kit-refs", "kit-consumers"].map((name) =>
      "await import(" + JSON.stringify(pathToFileURL(script(name)).href) + ");",
    ).join("\n") + '\nprocess.stdout.write("imports only\\n");\n',
  });
  const result = processes.run(processes.node(), [join(scratch.root, "import-only.mjs")], app);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("imports only\n");
  expect(result.stderr).toBe("");
}, 35_000);
