import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { CACHE_APP, removeCacheApps, scratch, writeApp } from "../lib/cache-fixture.js";

afterEach(removeCacheApps);

const engine = resolve(import.meta.dirname, "../..");

test("--fresh-compare extracts again and passes only when the cached snapshot and findings equal it", () => {
  const base = scratch("kit-fresh-compare-");
  const app = join(base, "app");
  writeApp(app, {
    ...CACHE_APP,
    "kit/config.md":
      "```yaml\napp: numbers\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nignore: [evidence/]\n```\n",
    "kit/debt/legacy.json": "{}",
  });
  const run = () =>
    spawnSync(
      process.execPath,
      [
        join(engine, "scripts/kit-check.mjs"),
        "--root=.",
        "--config=kit/config.md",
        "--baseline=kit/debt/legacy.json",
        "--fresh-compare",
      ],
      {
        cwd: app,
        encoding: "utf8",
        timeout: 240_000,
        env: { ...process.env, XDG_CACHE_HOME: join(base, "cache") },
      },
    );
  const cold = run();
  const warm = run();
  for (const result of [cold, warm]) {
    expect(result.stderr).not.toMatch(/diverged/);
    expect(result.stdout).toMatch(/the cached snapshot equals a fresh extraction/);
  }
  expect(cold.stdout).toMatch(/"reused":false/);
  expect(warm.stdout).toMatch(/"reused":true/);
}, 600_000);
