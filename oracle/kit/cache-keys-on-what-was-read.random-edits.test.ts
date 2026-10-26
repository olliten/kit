import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { cacheApp, removeCacheApps, CACHE_CONFIG } from "../substrate/compositions/cache-proof.js";


afterEach(removeCacheApps);

// A fixed seed, so a failure replays; each step picks one edit, inside or outside what extraction reads.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const EDITS: readonly ((app: ReturnType<typeof cacheApp>, n: number) => void)[] = [
  (app, n) => app.put("src/core/primitives/value.ts", `export const value = ${n};\n`),
  (app, n) => app.put(`src/core/primitives/extra-${n % 3}.ts`, `export const extra = ${n};\n`),
  (app, n) => {
    const path = join(app.root, `src/core/primitives/extra-${n % 3}.ts`);
    if (existsSync(path)) rmSync(path);
  },
  (app, n) =>
    app.put(
      "node_modules/a/index.d.ts",
      `export interface Shape { readonly n: ${n % 2 === 0 ? "number" : "string"}; }\n`,
    ),
  (app, n) => app.put(`evidence/read-cost/${n}.json`, `{"n":${n}}\n`),
  (app, n) => app.put("node_modules/a/README.md", `# a ${n}\n`),
  (app, n) => app.put("spec/numbers.md", `# Numbers\n\nNumbers ${n % 2}.\n`),
  (app, n) => {
    const path = join(app.root, "node_modules/@types/x/index.d.ts");
    if (n % 2 === 0) app.put("node_modules/@types/x/index.d.ts", "declare const x: number;\n");
    else if (existsSync(path)) rmSync(join(app.root, "node_modules/@types"), { recursive: true });
  },
];

test("over seeded random edits, the cached snapshot always equals a fresh read", async () => {
  const app = cacheApp();
  const next = random(20261016);
  let hits = 0;
  for (let step = 0; step < 16; step++) {
    const edits = 1 + Math.floor(next() * 2);
    for (let i = 0; i < edits; i++)
      EDITS[Math.floor(next() * EDITS.length)]?.(app, Math.floor(next() * 1000));
    const cached = await app.run();
    if (cached.receipt.reused) hits++;
    expect(cached.result).toEqual(readSnapshot(app.root, CACHE_CONFIG));
  }
  // The walk proves equivalence on both paths: some steps reused an entry, some extracted.
  expect(hits).toBeGreaterThan(0);
  expect(app.counts().extractions).toBeGreaterThan(1);
}, 600_000);
