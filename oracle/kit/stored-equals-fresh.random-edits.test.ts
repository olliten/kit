import { afterEach, expect, test } from "vitest";
import { type SmallApp, smallApp } from "../substrate/compositions/extraction-proof.js";

const apps: SmallApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
});

// A fixed seed, so a failure replays; each step picks one edit, inside or outside what extraction reads.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const EDITS: readonly ((app: SmallApp, n: number) => void)[] = [
  (app, n) => app.put("src/core/primitives/value.ts", `export const value = ${n};\n`),
  (app, n) => app.put(`src/core/primitives/extra-${n % 3}.ts`, `export const extra = ${n};\n`),
  (app, n) => app.remove(`src/core/primitives/extra-${n % 3}.ts`),
  (app, n) =>
    app.put(
      "src/core/readings/half.ts",
      n % 2 === 0
        ? "export const half = (n: number): number => n / 2;\n"
        : 'import { value } from "../primitives/value.js";\nexport const half = (n: number): number => n / value;\n',
    ),
  (app, n) =>
    app.put(
      "src/core/readings/double.ts",
      `import type { Shape } from "a";\nimport { value } from "../primitives/value.js";\nexport const double = (shape: Shape): number => shape.n * value * ${n};\n`,
    ),
  (app, n) => app.put("src/core/readings/third.ts", n % 2 === 0 ? `export const third = (n: number) => n / ${n};\n` : `export const third = (n: number) => String(n / ${n});\n`),
  (app, n) => app.put("node_modules/a/index.d.ts", `export interface Shape { readonly n: ${n % 2 === 0 ? "number" : "string"}; }\n`),
  (app, n) => app.put(`evidence/read-cost/${n}.json`, `{"n":${n}}\n`),
  (app, n) => app.put("node_modules/a/README.md", `# a ${n}\n`),
  (app, n) => app.put("spec/numbers.md", `# Numbers\n\nNumbers ${n % 2}.\n`),
  (app, n) => app.put("src/core/primitives/limit.ts", `declare global {\n  var limit: ${n % 2 === 0 ? "number" : "string"};\n}\nexport {};\n`),
  (app, n) =>
    app.put(
      "oracle/numbers/value-doubles.test.ts",
      `import { double } from "../../src/core/readings/double.js";\nexport const doubled = double({ n: ${n} });\n`,
    ),
];

test("over seeded random edits, a read through the store always equals a read without it", () => {
  const app = smallApp();
  apps.push(app);
  const next = random(20261029);
  let reused = 0;
  for (let step = 0; step < 16; step++) {
    const edits = 1 + Math.floor(next() * 2);
    for (let i = 0; i < edits; i++) EDITS[Math.floor(next() * EDITS.length)]?.(app, Math.floor(next() * 1000));
    const { snapshot, receipt } = app.stored();
    reused += receipt.files.reused;
    expect(snapshot).toEqual(app.fresh());
  }
  // The walk proves equivalence on both paths: steps reused facts, and steps computed them.
  expect(reused).toBeGreaterThan(0);
}, 600_000);
