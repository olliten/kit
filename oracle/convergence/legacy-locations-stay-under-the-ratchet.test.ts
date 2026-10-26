import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { layoutCheck } from "../../src/core/readings/layout-check.js";
import { legacySize } from "../../src/core/readings/legacy-size.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

import { ratchetFindings, startupCheckRoots } from "../../src/core/readings/ratchet.js";
const config: Partial<KitConfig> = {
  srcRoot: ["src", "oracle"],
  layout: { legacy: ["old-tests"] },
};

test("legacy helpers are extracted, sized and checked without acquiring placement", () => {
  const path = "old-tests/core/readings/now.ts";
  const snapshot = sourceFixture({ [path]: "export const now: number = Date.now();" }, config);
  expect(snapshot.sizes).toEqual([expect.objectContaining({ file: path, statements: 1 })]);
  expect(legacySize(snapshot)).toEqual([
    expect.objectContaining({ path, statements: 1, calls: 0, category: "legacy-debt" }),
  ]);
  expect(placementOf(path, snapshot.config.srcRoot)).toEqual({ placed: false });
  expect(capabilityCheck(snapshot).findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ path, debtKey: expect.stringContaining("raw-primitive"), category: "legacy-debt" }),
  ]));
});

test("an exact root-level legacy script receives accounting too", () => {
  const path = "runner.config.ts";
  const snapshot = sourceFixture({ [path]: "export const value: number = 1;" }, {
    ...config, layout: { legacy: [path] },
  });
  expect(layoutCheck(snapshot)).toEqual([expect.objectContaining({ path, category: "legacy-debt" })]);
  expect(legacySize(snapshot)).toEqual([expect.objectContaining({ path, statements: 1 })]);
});

test.each(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"])(
  "legacy .%s helpers keep their location, size and clock obligations",
  (extension) => {
    const path = `old-tests/clock.${extension}`;
    const snapshot = sourceFixture({
      [path]: "const stamp = Date.now();",
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
          lib: ["ES2022"], types: [], strict: true, noEmit: true,
          allowJs: true, checkJs: true, jsx: "preserve",
        },
        include: ["old-tests/**/*"],
      }),
    }, config);
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    expect(layoutCheck(snapshot)).toEqual([
      expect.objectContaining({ path, category: "legacy-debt" }),
    ]);
    expect(legacySize(snapshot)).toEqual([
      expect.objectContaining({ path, statements: 1, calls: 0, category: "legacy-debt" }),
    ]);
    expect(capabilityCheck(snapshot).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ path, debtKey: expect.stringContaining("raw-primitive"), category: "legacy-debt" }),
    ]));
  },
);

test.each([["mts", "mjs"], ["cts", "cjs"]])(
  "a .%s helper imported as .%s keeps its real identity and blocking limits",
  (extension, emitted) => {
    const path = "src/core/readings/value.ts";
    const helper = `old-tests/value.${extension}`;
    const snapshot = sourceFixture({
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
          lib: ["ES2022"], types: [], strict: true, noEmit: true,
        },
        include: ["src/**/*.ts", "old-tests/**/*"],
      }),
      [path]: `import { value } from '../../../old-tests/value.${emitted}'; export function read(name: string): unknown { return value(name); }`,
      [helper]: "export function value(name: string): unknown { return Reflect.get(globalThis, name); }",
      "old-tests/value.ts": "export function value(_name: string): unknown { return undefined; }",
    }, config);
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    expect(snapshot.imports.filter((edge) => edge.from === path)).toEqual([
      { from: path, to: helper },
    ]);
    const limits = capabilityCheck(snapshot).findings.filter(
      (item) => item.path === helper && item.category === "checker-limit",
    );
    expect(limits.length).toBeGreaterThan(0);
    const baseline = Object.fromEntries(limits.map((item) => [item.debtKey, null]));
    expect(ratchetFindings(limits, baseline, [path], snapshot.imports))
      .toEqual(expect.arrayContaining(limits));
  },
);

test("location debt does not cover helper growth or a new helper in its directory", () => {
  const path = "old-tests/helper.ts";
  const inspect = (files: Readonly<Record<string, string>>) => sourceFixture(files, config);
  const before = inspect({ [path]: "export const one: number = 1;" });
  const findings = [...layoutCheck(before), ...legacySize(before)];
  const baseline = {
    ...Object.fromEntries(layoutCheck(before).map(({ debtKey }) => [debtKey, null])),
    ...Object.fromEntries(legacySize(before).map(({ debtKey, statements, calls }) =>
      [debtKey, { statements, calls }],
    )),
  };
  expect(ratchetFindings(findings, baseline, [], [], [])).toEqual([]);
  const grown = inspect({
    [path]: "export const one: number = 1; export const two: number = 2;",
    "old-tests/new.ts": "export const value: number = 3;",
  });
  const failures = ratchetFindings([...layoutCheck(grown), ...legacySize(grown)], baseline, [], [], []);
  expect(failures.map(({ debtKey }: { debtKey: string }) => debtKey).sort()).toEqual([
    "R1:file-role:old-tests/new.ts", "R1:legacy-size:old-tests/helper.ts", "R1:legacy-size:old-tests/new.ts",
  ]);
});

test("placed code still cannot capture legacy clock authority through a helper", () => {
  const path = "src/core/readings/now.ts";
  const snapshot = sourceFixture({
    [path]: "import { now } from '../../../old-tests/clock.js'; export function value(): number { return now(); }",
    "old-tests/clock.ts": "export function now(): number { return Date.now(); }",
  }, {
    ...config, layout: { legacy: ["old-tests", "src"] },
    legacyZones: [{ root: "old-tests", zone: "substrate" }],
  });
  const result = capabilityCheck(snapshot);
  expect(result.findings.some((item) => item.path === path && item.category === "placed-violation")).toBe(true);
  const baseline = Object.fromEntries(result.findings.map((item) => [item.debtKey, null]));
  expect(ratchetFindings(result.findings, baseline, [path], snapshot.imports))
    .toEqual(expect.arrayContaining([expect.objectContaining({ path, category: "placed-violation" })]));
});

test("declared legacy entrypoints retain blocking reachable checker limits", () => {
  const path = "old-tests/start.ts";
  const snapshot = sourceFixture({
    [path]: "export const get = (name: string): unknown => Reflect.get(globalThis, name);",
  }, { ...config, exceptions: [path] });
  const result = capabilityCheck(snapshot);
  const roots = startupCheckRoots(snapshot.config);
  expect(roots).toEqual([path]);
  const limits = result.findings.filter((item) => item.path === path && item.category === "checker-limit");
  expect(limits.length).toBeGreaterThan(0);
  const baseline = Object.fromEntries(result.findings.map((item) => [item.debtKey, null]));
  expect(ratchetFindings(result.findings, baseline, [], snapshot.imports, roots))
    .toEqual(expect.arrayContaining(limits));
});
