import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { cacheApp, removeCacheApps, rereaders as adapters, CACHE_CONFIG } from "../substrate/compositions/cache-proof.js";

import { cachedKitCheck } from "../../src/substrate/compositions/cached-check.js";

afterEach(removeCacheApps);

test("a cache hit reuses extraction, reruns the checker and gives it the snapshot a fresh read gives", async () => {
  const app = cacheApp();
  const first = await app.run();
  const second = await app.run();
  expect(first.receipt.reused).toBe(false);
  expect(second.receipt.reused).toBe(true);
  expect(app.counts()).toEqual({ extractions: 1, checks: 2 });
  expect(second.result).toEqual(readSnapshot(app.root, CACHE_CONFIG));
}, 120_000);

test.each(["payload and trace", "index"])(
  "a corrupt %s is rebuilt, never accepted as evidence",
  async (part) => {
    const app = cacheApp();
    await app.run();
    if (part === "index") writeFileSync(join(app.cacheDir, "index.json"), "{ invalid");
    else
      for (const name of readdirSync(join(app.cacheDir, "objects")))
        writeFileSync(join(app.cacheDir, "objects", name), "{ invalid");
    const rebuilt = await app.run();
    expect(rebuilt.receipt.reused).toBe(false);
    expect(rebuilt.result).toEqual(readSnapshot(app.root, CACHE_CONFIG));
    const reused = await app.run();
    expect(reused.receipt.reused).toBe(true);
    expect(app.counts()).toEqual({ extractions: 2, checks: 3 });
    expect(JSON.parse(readFileSync(join(app.cacheDir, "index.json"), "utf8")).entries).toHaveLength(1);
  },
  120_000,
);

test("source mutation during extraction rejects the result", async () => {
  const app = cacheApp();
  await expect(
    cachedKitCheck(
      app.root,
      CACHE_CONFIG,
      (...args: Parameters<typeof app.read>) => {
        const snapshot = app.read(...args);
        app.put("src/core/primitives/value.ts", "export const value = 8;\n");
        return snapshot;
      },
      app.check,
      adapters,
      { cacheDir: app.cacheDir },
    ),
  ).rejects.toThrow(/inputs changed/);
  expect(app.counts().checks).toBe(0);
}, 120_000);

test("source mutation during cached checking rejects the result", async () => {
  const app = cacheApp();
  await app.run();
  await expect(
    cachedKitCheck(
      app.root,
      CACHE_CONFIG,
      app.read,
      () => app.put("node_modules/a/index.d.ts", "export interface Shape { readonly n: string; }\n"),
      adapters,
      { cacheDir: app.cacheDir },
    ),
  ).rejects.toThrow(/inputs changed/);
  expect(app.counts().extractions).toBe(1);
}, 120_000);
