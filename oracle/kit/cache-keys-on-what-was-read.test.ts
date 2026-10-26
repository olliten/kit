import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { cacheApp, removeCacheApps, CACHE_CONFIG } from "../substrate/compositions/cache-proof.js";


afterEach(removeCacheApps);

// Each change alters something extraction read: a file's bytes, a directory listing, a probe or the config.
const MISSES: Readonly<Record<string, (app: ReturnType<typeof cacheApp>) => void>> = {
  "an edited source file": (app) => app.put("src/core/primitives/value.ts", "export const value = 8;\n"),
  "a deleted source file": (app) => rmSync(join(app.root, "src/core/primitives/value.ts")),
  "an edited declaration in a package": (app) =>
    app.put("node_modules/a/index.d.ts", "export interface Shape { readonly n: string; }\n"),
  "an edited package manifest": (app) =>
    app.put("node_modules/a/package.json", JSON.stringify({ name: "a", types: "other.d.ts" })),
  "an edited project file": (app) =>
    app.put(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { strict: false }, include: ["src/**/*.ts"] }),
    ),
  "an edited topic": (app) => app.put("spec/numbers.md", "# Numbers\n\nOther numbers.\n"),
  "a new file in a listed directory": (app) => app.put("src/core/primitives/other.ts", "export {};\n"),
  "a new non-source file in a listed directory": (app) => app.put("src/notes.txt", "notes\n"),
  "a new types package where resolution probed": (app) =>
    app.put("node_modules/@types/x/index.d.ts", "declare const x: number;\n"),
};

test.each(Object.keys(MISSES))(
  "%s misses",
  async (change) => {
    const app = cacheApp();
    await app.run();
    MISSES[change]?.(app);
    const changed = await app.run();
    expect(changed.receipt.reused).toBe(false);
    expect(changed.result).toEqual(readSnapshot(app.root, CACHE_CONFIG));
    expect(app.counts()).toEqual({ extractions: 2, checks: 2 });
  },
  120_000,
);

test("a changed config misses", async () => {
  const app = cacheApp();
  await app.run();
  const changed = await app.run({ ...CACHE_CONFIG, ignore: ["evidence", "other"] });
  expect(changed.receipt.reused).toBe(false);
}, 120_000);

test("legacy coverage and a new legacy helper invalidate cached size accounting", async () => {
  const app = cacheApp();
  app.put("historical/helper.ts", "export const value = 1;\n");
  const initial = await app.run();
  expect(initial.result.sizes?.some(({ file }) => file === "historical/helper.ts")).toBe(false);
  const config = { ...CACHE_CONFIG, layout: { legacy: ["historical"] } };
  const covered = await app.run(config);
  expect(covered.receipt.reused).toBe(false);
  expect(covered.result.sizes).toContainEqual(expect.objectContaining({ file: "historical/helper.ts" }));
  app.put("historical/new.ts", "export const value = 2;\n");
  const changed = await app.run(config);
  expect(changed.receipt.reused).toBe(false);
  expect(changed.result.sizes).toContainEqual(expect.objectContaining({ file: "historical/new.ts" }));
  const unchanged = await app.run(config);
  expect(unchanged.receipt.reused).toBe(true);
  expect(unchanged.result).toEqual(readSnapshot(app.root, config));
  expect(app.counts()).toEqual({ extractions: 3, checks: 4 });
}, 120_000);

// None of these is a read extraction made, so none can change the snapshot.
const HITS: Readonly<Record<string, (app: ReturnType<typeof cacheApp>) => void>> = {
  "a new file in an ignored path": (app) => app.put("evidence/read-cost/2.json", "{}\n"),
  "an edited file in an ignored path": (app) => app.put("evidence/read-cost/1.json", '{"n":1}\n'),
  "an edited package file the compiler never opens": (app) => app.put("node_modules/a/README.md", "# b\n"),
  "a new package file the compiler never opens": (app) => app.put("node_modules/a/CHANGELOG.md", "1.0.0\n"),
};

test.each(Object.keys(HITS))(
  "%s hits",
  async (change) => {
    const app = cacheApp();
    await app.run();
    HITS[change]?.(app);
    const unchanged = await app.run();
    expect(unchanged.receipt.reused).toBe(true);
    expect(unchanged.result).toEqual(readSnapshot(app.root, CACHE_CONFIG));
    expect(app.counts()).toEqual({ extractions: 1, checks: 2 });
  },
  120_000,
);
