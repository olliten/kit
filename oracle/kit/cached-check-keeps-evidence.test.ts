import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

const cacheSource =
  process.env.KIT_CACHE_SOURCE ??
  new URL("../../scripts/kit-snapshot-cache.mjs", import.meta.url).href;
const { cachedKitCheck } = await import(cacheSource);
const roots: string[] = [];
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "kit-cache-proof-"));
  roots.push(root);
  const put = (path: string, source: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  put("src/value.ts", "export const value = 7;");
  let extractions = 0;
  let checks = 0;
  const limits = [{ rule: "R1", status: "unresolved", debtKey: "package:unknown" }];
  const read = async () => {
    extractions++;
    return { limits };
  };
  const check = (snapshot: { limits: typeof limits }) => {
    checks++;
    return snapshot.limits;
  };
  const run = (config = {}) => cachedKitCheck(root, config, read, check);
  return { root, put, read, check, run, counts: () => ({ extractions, checks }), limits };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("a cache hit reuses extraction, reruns the checker and retains unresolved evidence", async () => {
  const fixture = makeFixture();
  const first = await fixture.run();
  const second = await fixture.run();
  expect(first.receipt.reused).toBe(false);
  expect(second.receipt.reused).toBe(true);
  expect(fixture.counts()).toEqual({ extractions: 1, checks: 2 });
  expect(second.result).toEqual(fixture.limits);
});

test.each(["untracked", "deleted", "config", "dependency"])(
  "%s changes invalidate saved extraction",
  async (change) => {
    const fixture = makeFixture();
    if (change === "dependency")
      fixture.put("node_modules/a/index.d.ts", "export interface Value { readonly n: number; }");
    await fixture.run();
    let config = {};
    if (change === "untracked") fixture.put("src/new.ts", "export const added = 9;");
    if (change === "deleted") rmSync(join(fixture.root, "src/value.ts"));
    if (change === "config") config = { packages: [{ name: "a", capabilities: ["storage.read"] }] };
    if (change === "dependency")
      fixture.put("node_modules/a/index.d.ts", "export interface Value { readonly n: string; }");
    const result = await fixture.run(config);
    expect(result.receipt.reused).toBe(false);
    expect(fixture.counts()).toEqual({ extractions: 2, checks: 2 });
  },
);

test.each([".vite/vitest/results.json", ".vitest/results.json"])(
  "generated runner output at %s does not invalidate extraction, but dependency declarations do",
  async (runnerOutput) => {
    const fixture = makeFixture();
    fixture.put("node_modules/a/index.d.ts", "export interface Value { readonly n: number; }");
    await fixture.run();
    fixture.put(`node_modules/${runnerOutput}`, JSON.stringify({ duration: 123 }));
    const warmed = await fixture.run();
    expect(warmed.receipt.reused).toBe(true);
    expect(fixture.counts()).toEqual({ extractions: 1, checks: 2 });
    expect(warmed.result).toEqual(fixture.limits);
    fixture.put("node_modules/a/index.d.ts", "export interface Value { readonly n: string; }");
    const changed = await fixture.run();
    expect(changed.receipt.reused).toBe(false);
    expect(fixture.counts()).toEqual({ extractions: 2, checks: 3 });
  },
);

test("corrupt cache is rebuilt, never accepted as evidence", async () => {
  const fixture = makeFixture();
  await fixture.run();
  fixture.put("node_modules/.cache/kit/snapshot.json", "{ invalid");
  const result = await fixture.run();
  expect(result.receipt.reused).toBe(false);
  expect(fixture.counts()).toEqual({ extractions: 2, checks: 2 });
});

test("source mutation during extraction rejects the result", async () => {
  const fixture = makeFixture();
  await expect(
    cachedKitCheck(
      fixture.root,
      {},
      async () => {
        fixture.put("src/value.ts", "export const value = 8;");
        return { limits: fixture.limits };
      },
      fixture.check,
    ),
  ).rejects.toThrow(/inputs changed/);
  expect(fixture.counts().checks).toBe(0);
});

test("source mutation during cached checking rejects the result", async () => {
  const fixture = makeFixture();
  await fixture.run();
  await expect(
    cachedKitCheck(
      fixture.root,
      {},
      fixture.read,
      (snapshot: { limits: typeof fixture.limits }) => {
        fixture.put("src/value.ts", "export const value = 8;");
        return snapshot.limits;
      },
    ),
  ).rejects.toThrow(/inputs changed/);
});
