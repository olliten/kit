import { join } from "node:path";
import { expect, test } from "vitest";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";

const engine = join(import.meta.dirname, "../..");
const apps = textFiles
  .entries(join(engine, "fixture"))
  .filter((entry) => entry.directory)
  .map((entry) => entry.name);

test("Kit ships at least one example app", () => {
  expect(apps.length).toBeGreaterThan(0);
});

test.each(apps)("the %s example declares an empty baseline and passes its check", async (app) => {
  const root = join(engine, "fixture", app);
  const baseline = join(root, "kit/debt/legacy.json");
  expect(JSON.parse(textFiles.read(baseline))).toEqual({});
  const result = await runCheck({
    engineRoot: engine,
    args: ["--root", root, "--config", join(root, "kit/config.md"), "--baseline", baseline],
    cwd: engine,
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain('"counts":{}');
}, 120_000);
