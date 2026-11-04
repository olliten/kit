import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import { runConsumers } from "../../src/substrate/compositions/consumers-run.js";

const engine = resolve(import.meta.dirname, "../..");
const scratch = mkdtempSync(join(tmpdir(), "kit-consumers-integration-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const lock = (resolved: string) => JSON.stringify({ packages: { "node_modules/kit": { resolved } } });

test("the real run checks an app checkout against this Kit and does not fail on the app's findings", async () => {
  const app = join(scratch, "tally");
  cpSync(join(engine, "examples/tally"), app, { recursive: true });
  // The known violation: a module no claim names, planted in the copy of the clean example.
  mkdirSync(join(app, "src/substrate/compositions"), { recursive: true });
  writeFileSync(join(app, "src/substrate/compositions/save.ts"), "export function save(text: string): string {\n  return text;\n}\n");
  writeFileSync(join(app, "package-lock.json"), lock("git+https://github.com/olliten/kit.git#552affb"));
  const { stdout: output, exitCode } = await runConsumers({ engineRoot: engine, args: [app], cwd: engine });
  expect(exitCode).toBe(0);
  expect(output).toMatch(/^tally: \d+ failing \(pins 552affb\): /);
  expect(output).toContain("  R4:unreferenced-module:substrate/compositions/save:");
}, 120_000);

test("an app whose config this Kit does not accept is reported with the config error", async () => {
  const app = join(scratch, "stale");
  cpSync(join(engine, "examples/tally"), app, { recursive: true });
  const config = join(app, "kit/config.md");
  writeFileSync(config, readFileSync(config, "utf8").replace("```yaml\n", "```yaml\nzones: {core: src/core/}\n"));
  const { stdout: output, exitCode } = await runConsumers({ engineRoot: engine, args: [app], cwd: engine });
  expect(exitCode).toBe(0);
  expect(output).toContain(`${app}: Kit config ${config}: zones is not a key Kit reads.`);
}, 120_000);
