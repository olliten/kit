import { afterEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { cacheApp, removeCacheApps, CACHE_CONFIG } from "../substrate/compositions/cache-proof.js";
import { snapshotStore } from "../../src/substrate/adapters/snapshot-store.js";
import { CACHE_VERSION } from "../../src/core/readings/snapshot-cache-key.js";

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
    if (part === "index") app.putCache("index.json", "{ invalid");
    else
      for (const entry of snapshotStore.index(app.cacheDir, CACHE_VERSION).entries)
        for (const id of [entry.payload, entry.trace]) app.putCache(`objects/${id}.json`, "{ invalid");
    const rebuilt = await app.run();
    expect(rebuilt.receipt.reused).toBe(false);
    expect(rebuilt.result).toEqual(readSnapshot(app.root, CACHE_CONFIG));
    const reused = await app.run();
    expect(reused.receipt.reused).toBe(true);
    expect(app.counts()).toEqual({ extractions: 2, checks: 3 });
    expect(snapshotStore.index(app.cacheDir, CACHE_VERSION).entries).toHaveLength(1);
  },
  120_000,
);

test("source mutation during extraction rejects the result", async () => {
  const app = cacheApp();
  await expect(
    app.run({ editDuringRead: { path: "src/core/primitives/value.ts", text: "export const value = 8;\n" } }),
  ).rejects.toThrow(/inputs changed/);
  expect(app.counts().checks).toBe(0);
}, 120_000);

test("source mutation during cached checking rejects the result", async () => {
  const app = cacheApp();
  await app.run();
  await expect(
    app.run({
      editDuringCheck: { path: "node_modules/a/index.d.ts", text: "export interface Shape { readonly n: string; }\n" },
    }),
  ).rejects.toThrow(/inputs changed/);
  expect(app.counts().extractions).toBe(1);
}, 120_000);
