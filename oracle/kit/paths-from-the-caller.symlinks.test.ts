import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, expect, test } from "vitest";

const engine = resolve(import.meta.dirname, "../..");
const scratch = mkdtempSync(join(tmpdir(), "kit-symlink-cli-"));
const app = join(scratch, "tally");
for (const folder of ["src", "spec", "oracle"]) {
  cpSync(join(engine, "fixture", folder), join(app, folder), { recursive: true });
}
mkdirSync(join(app, "kit/debt"), { recursive: true });
mkdirSync(join(app, "node_modules"), { recursive: true });
symlinkSync(engine, join(app, "node_modules/kit"), "dir");
const config = join(app, "kit/config.md");
const baseline = join(app, "kit/debt/legacy.json");
writeFileSync(config, "```yaml\napp: tally\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\n```\n");
writeFileSync(baseline, "{}");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const script = (name: string) => join(app, "node_modules/kit/scripts", name + ".mjs");
function run(name: string, args: readonly string[]) {
  const result = spawnSync(process.execPath, [script(name), ...args], {
    cwd: app, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
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
  expect(result.stdout).toContain("core/readings/total keeps 1 claim:");
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
  const loader = join(scratch, "import-only.mjs");
  writeFileSync(loader, ["kit-check", "kit-refs", "kit-consumers"].map((name) =>
    "await import(" + JSON.stringify(pathToFileURL(script(name)).href) + ");",
  ).join("\n") + '\nprocess.stdout.write("imports only\\n");\n');
  const result = spawnSync(process.execPath, [loader], {
    cwd: app, encoding: "utf8", timeout: 30_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("imports only\n");
  expect(result.stderr).toBe("");
}, 35_000);
