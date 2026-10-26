import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { sameSnapshot } from "../../src/core/readings/snapshot-comparison.js";
import { cacheApp, removeCacheApps, rereaders as adapters, CACHE_CONFIG } from "../substrate/compositions/cache-proof.js";

import { cachedKitCheck } from "../../src/substrate/compositions/cached-check.js";

afterEach(removeCacheApps);

function graph(value: number, split = false) {
  let node: object = { value, "__@iterator@17": "__@iterator@17" };
  for (let depth = 0; depth < 35; depth++) node = { left: node, right: split ? { ...node } : node };
  return node;
}

test("fresh comparison handles exponentially shared graphs without requiring identical aliases", () => {
  expect(sameSnapshot(graph(7), graph(7, true))).toBe(true);
  expect(sameSnapshot(graph(7), graph(8))).toBe(false);
  expect(sameSnapshot({ "__@iterator@17": "__@iterator@17" }, { "__@iterator@91": "__@iterator@91" })).toBe(true);
  expect(sameSnapshot([], Array(2))).toBe(false);
  expect(sameSnapshot({ value: 7, absent: undefined }, { value: 7 })).toBe(true);
});

test("a graph JSON cannot encode is cached, checked again, invalidated and rebuilt after corruption", async () => {
  const app = cacheApp();
  const read = (...args: Parameters<typeof app.read>) => {
    const snapshot = app.read(...args);
    return Object.assign(snapshot, { self: snapshot, fixtureRoot: args[0] });
  };
  const run = () => cachedKitCheck(app.root, CACHE_CONFIG, read, app.check, adapters, { cacheDir: app.cacheDir });
  const first = await run();
  const hit = await run();
  expect(first.receipt.storageError).toBeUndefined();
  expect(hit.receipt.reused).toBe(true);
  expect(Reflect.get(hit.snapshot, "self")).toBe(hit.snapshot);
  expect(app.counts()).toEqual({ extractions: 1, checks: 2 });

  app.put("src/core/primitives/value.ts", "export const value = 8;\n");
  expect((await run()).receipt.reused).toBe(false);
  const index = JSON.parse(readFileSync(join(app.cacheDir, "index.json"), "utf8"));
  const entry = index.entries.at(-1);
  writeFileSync(join(app.cacheDir, "objects", entry.payload + ".json"), "corrupt");
  expect((await run()).receipt.reused).toBe(false);
  expect((await run()).receipt.reused).toBe(true);

  const other = cacheApp();
  const relocated = await cachedKitCheck(other.root, CACHE_CONFIG, read, app.check, adapters, { cacheDir: app.cacheDir });
  expect(relocated.receipt.reused).toBe(false);
  expect(Reflect.get(relocated.snapshot, "fixtureRoot")).toBe(other.root);
}, 120_000);

test("a reused binary graph still rejects an input mutation during checking", async () => {
  const app = cacheApp();
  const read = (...args: Parameters<typeof app.read>) => {
    const snapshot = app.read(...args);
    return Object.assign(snapshot, { self: snapshot });
  };
  await cachedKitCheck(app.root, CACHE_CONFIG, read, app.check, adapters, { cacheDir: app.cacheDir });
  await expect(cachedKitCheck(app.root, CACHE_CONFIG, read, () => {
    app.put("src/core/primitives/value.ts", "export const value = 9;\n");
  }, adapters, { cacheDir: app.cacheDir })).rejects.toThrow(/inputs changed/);
  expect(app.counts().extractions).toBe(1);
}, 120_000);

test("a storage failure is visible without changing the fresh verdict", async () => {
  const app = cacheApp();
  const result = await cachedKitCheck(app.root, CACHE_CONFIG, app.read, app.check, adapters, {
    cacheDir: join(app.root, "tsconfig.json"),
  });
  expect(result.receipt.storageError).toMatch(/ENOTDIR|EEXIST/);
  expect(result.receipt.reused).toBe(false);
  expect(result.result).toEqual(result.snapshot);
  expect(app.counts()).toEqual({ extractions: 1, checks: 1 });
}, 120_000);
