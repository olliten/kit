import { expect, test } from "vitest";
import { gate } from "../../src/core/compositions/gate.js";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { forwarderCheck } from "../../src/core/readings/forwarder-check.js";
import { ratchetFindings } from "../../src/core/readings/ratchet.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

// Two placed modules that do the work, which every case may re-export.
const leaves = {
  "src/core/readings/total.ts": "export function total(values: readonly number[]): number {\n  return values.length;\n}\n",
  "src/core/readings/count.ts": "export const count = 1;\n",
};
const total = "src/core/readings/total.ts";
const count = "src/core/readings/count.ts";

function forwarders(files: Readonly<Record<string, string>>, config: Partial<KitConfig> = {}) {
  const snapshot = sourceFixture({ ...leaves, ...files }, config);
  return gate(snapshot, snapshot.config).findings.filter((item) => item.debtKey.startsWith("R2:forwarder:"));
}

const keys = (files: Readonly<Record<string, string>>, config: Partial<KitConfig> = {}): string[] =>
  forwarders(files, config).map((item) => item.debtKey);

test("a module that only re-exports names is a forwarder whose fix names what it re-exports", () => {
  const path = "src/core/readings/sum.ts";
  const [found, ...more] = forwarders({ [path]: 'export { total } from "./total.js";\n' });
  expect(more).toEqual([]);
  expect(found?.debtKey).toBe(`R2:forwarder:${path}`);
  expect(found?.path).toBe(path);
  expect(found?.fix).toBe(
    `Point each importer at the module it uses (${total}) and delete this forwarder.`,
  );
});

test("a star re-export, several re-exports and an import exported again each forward", () => {
  const path = "src/core/readings/sum.ts";
  expect(keys({ [path]: 'export * from "./total.js";\n' })).toEqual([`R2:forwarder:${path}`]);
  const both = forwarders({
    [path]: '// Both readings, under one name.\nexport * from "./total.js";\nexport { count as many } from "./count.js";\n',
  });
  expect(both.map((item) => item.fix)).toEqual([
    `Point each importer at the module it uses (${count}, ${total}) and delete this forwarder.`,
  ]);
  expect(
    keys({ [path]: 'import { total } from "./total.js";\nimport { count } from "./count.js";\nexport { total };\nexport default count;\n' }),
  ).toEqual([`R2:forwarder:${path}`]);
  expect(
    keys({ [path]: 'import type { total as unused } from "./total.js";\nexport { count } from "./count.js";\n' }),
  ).toEqual([`R2:forwarder:${path}`]);
});

test("a module that re-exports and defines or does anything of its own is none", () => {
  const path = "src/core/readings/sum.ts";
  for (const own of [
    "export const twice = 2;\n",
    "export interface Sum {\n  readonly value: number;\n}\n",
    "type Local = number;\nexport type Shown = Local;\n",
    "count;\n",
  ])
    expect(keys({ [path]: `import { count } from "./count.js";\nexport { total } from "./total.js";\n${own}` })).toEqual([]);
  expect(keys({ [path]: 'import "./count.js";\nexport { total } from "./total.js";\n' })).toEqual([]);
  expect(keys({ [path]: 'import { total } from "./total.js";\n' })).toEqual([]);
  expect(keys({ [path]: "" })).toEqual([]);
});

test("a placed forwarder is a violation, and a legacy one is debt the baseline may hold but never add", () => {
  const placed = "src/core/readings/sum.ts";
  const legacy = "src/legacy/sum.ts";
  const found = forwarders({
    [placed]: 'export { total } from "./total.js";\n',
    [legacy]: 'export { total } from "../core/readings/total.js";\n',
  });
  expect(found.map(({ path, category }) => [path, category])).toEqual([
    [placed, "placed-violation"],
    [legacy, "legacy-debt"],
  ]);
  expect(found.every((item) => item.blocking)).toBe(true);
  const keyOf = (path: string): string => `R2:forwarder:${path}`;
  const fails = (baseline: readonly string[]): string[] =>
    ratchetFindings(found, baseline, [placed], [], []).map((item) => item.path);
  expect(fails([keyOf(legacy), keyOf(placed)])).toEqual([placed]);
  expect(fails([])).toEqual([placed, legacy]);
});

test("a declared entrypoint, such as a package's public index, and a declaration file are exempt", () => {
  const index = "src/index.ts";
  const files = {
    [index]: 'export * from "./core/readings/total.js";\n',
    "src/core/readings/shape.d.ts": 'export * from "./count.js";\n',
  };
  expect(keys(files)).toEqual([`R2:forwarder:${index}`]);
  expect(keys(files, { exceptions: [index] })).toEqual([]);
});

test("a forwarder in a configured legacy location outside the code roots is debt too", () => {
  const path = "lib/sum.ts";
  const found = forwarderCheck(
    sourceFixture({ ...leaves, [path]: 'export { total } from "../src/core/readings/total.js";\n' }, { layout: { legacy: ["lib"] } }),
  );
  expect(found.map(({ path: at, category, fix }) => [at, category, fix])).toEqual([
    [path, "legacy-debt", `Point each importer at the module it uses (${total}) and delete this forwarder.`],
  ]);
});
