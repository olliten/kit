import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

function inspect(
  files: Readonly<Record<string, string>>,
  extraAdapters: NonNullable<KitConfig["adapters"]> = [],
  adapterDirectory: "adapters" | "ports" = "adapters",
) {
  const root = mkdtempSync(join(tmpdir(), "kit-same-file-handles-"));
  try {
    const inputs = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM"],
          types: [],
          strict: true,
          noEmit: true,
          declaration: true,
          isolatedDeclarations: true,
        },
        include: ["src/**/*.ts"],
      }),
      [`src/substrate/${adapterDirectory}/clock.ts`]:
        "export interface Clock { now(): number; }\nexport const clock: Clock = { now: () => Date.now() };\n",
      [`src/shell/${adapterDirectory}/render.ts`]:
        "export interface Rendering { create(): HTMLElement; paint(element: HTMLElement, view: { readonly text: string }): void; }\n" +
        "export const rendering: Rendering = { create: () => document.createElement('button'), paint: (element, view) => { element.textContent = view.text; } };\n",
      [`src/shell/${adapterDirectory}/focus.ts`]:
        "export interface Focus { to(element: HTMLElement): void; }\n" +
        "export const focus: Focus = { to: (element) => element.focus() };\n",
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const snapshot = readSnapshot(root, {
      ...DEFAULT_CONFIG,
      layerNames: {
        primitives: "primitives",
        readings: "readings",
        adapters: adapterDirectory,
        compositions: "compositions",
      },
      adapters: [
        {
          module: "substrate/adapters/clock",
          export: "clock",
          capability: "clock.read",
          kind: "external",
          zones: ["substrate"],
          contract: { type: "Clock" },
          primitives: ["clock"],
        },
        {
          module: "shell/adapters/render",
          export: "rendering",
          capability: "dom.render",
          kind: "external",
          zones: ["shell"],
          contract: { type: "Rendering" },
          globals: ["document"],
        },
        {
          module: "shell/adapters/focus",
          export: "focus",
          capability: "dom.focus",
          kind: "external",
          zones: ["shell"],
          contract: { type: "Focus" },
        },
        ...extraAdapters,
      ],
    });
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    return capabilityCheck(snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const binding = (result: ReturnType<typeof inspect>): readonly string[] =>
  result.findings
    .map((finding) => finding.debtKey)
    .filter((key) => /^R1:(?:callable-binding|closure-binding|native-authority):/.test(key));

const store = "src/substrate/compositions/store.ts";
const clockImport = "import { clock } from '../adapters/clock.js';\n";
// The handles a composition is given: a live object with behaviour and a callback, neither under a contract.
const cache = "class Cache { private readonly values = new Map<string, number>(); read(key: string): number { return this.values.get(key) ?? clock.now(); } }\n";
const helper = "(read: () => number, held: Cache): number { return read() + held.read('a'); }\n";
const pass = "total(read, held)";
const given = "(read: () => number, held: Cache): number";

test("a composition passing the handle and callback it is given to its own unexported function needs no contract", () => {
  const result = inspect({
    [store]:
      clockImport +
      cache +
      `function total${helper}` +
      `const twice = (read: () => number, held: Cache): number => total(read, held) * 2;\n` +
      `export function run${given} { return ${pass} + twice(read, held); }\n`,
  });
  expect(binding(result)).toEqual([]);
});

test("a composition passing the handle and callback it is given to its own nested function or private method needs no contract", () => {
  const result = inspect({
    [store]:
      clockImport +
      cache +
      `class Ledger { private total${helper.replace("\n", "")} #again${helper.replace("\n", "")} check${given} { return this.total(read, held) + this.#again(read, held); } }\n` +
      `export function run${given} { const total = ${helper.replace("): number {", "): number => {").replace("\n", "")}; return ${pass} + new Ledger().check(read, held); }\n`,
  });
  expect(binding(result)).toEqual([]);
});

test("a Core composition passing its supplied callback to its own helper needs no contract", () => {
  const result = inspect({
    "src/core/compositions/twice.ts":
      "function apply(read: () => number): number { return read(); }\n" +
      "export function twice(read: () => number): number { return apply(read) + apply(read); }\n",
  });
  expect(binding(result)).toEqual([]);
});

const totalFile = "src/substrate/compositions/total.ts";
const cacheFile = {
  "src/substrate/compositions/cache.ts": clockImport + `export ${cache}`,
};

test("the same pass to a function in another file still needs a contract", () => {
  const result = inspect({
    ...cacheFile,
    [totalFile]: "import type { Cache } from './cache.js';\n" + `export function total${helper}`,
    [store]:
      clockImport +
      "import type { Cache } from './cache.js';\nimport { total } from './total.js';\n" +
      `export function run${given} { return ${pass}; }\n`,
  });
  expect(binding(result)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^R1:callable-binding:src\/substrate\/compositions\/store\.ts:src\/substrate\/compositions\/total\.ts:/),
    ]),
  );
});

test("a pass to an imported function this file re-exports still needs a contract", () => {
  const result = inspect({
    ...cacheFile,
    [totalFile]: "import type { Cache } from './cache.js';\n" + `export function total${helper}`,
    [store]:
      clockImport +
      "import type { Cache } from './cache.js';\nimport { total } from './total.js';\nexport { total };\n" +
      `export function run${given} { return ${pass}; }\n`,
  });
  expect(binding(result)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^R1:callable-binding:src\/substrate\/compositions\/store\.ts:src\/substrate\/compositions\/total\.ts:/),
    ]),
  );
});

test.each([
  ["an exported function", `export function total${helper}`, pass],
  ["a function exported by name", `function total${helper}export { total as sum };\n`, pass],
  ["a function exported as the default", `export default function total${helper}`, pass],
  ["a function held by an exported record", `export const totals = { total${helper.replace("\n", "")} };\n`, `totals.${pass}`],
  ["a public method of an exported class", `export class Totals { total${helper.replace("\n", "")} }\n`, `new Totals().${pass}`],
])("a same-file pass to %s escapes the file, so it still needs a contract", (_, declaration, call) => {
  const result = inspect({
    [store]: clockImport + cache + declaration + `export function run${given} { return ${call}; }\n`,
  });
  expect(binding(result)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^R1:callable-binding:src\/substrate\/compositions\/store\.ts:src\/substrate\/compositions\/store\.ts:/),
    ]),
  );
});

test("a reading passing a callback to its own helper is still a boundary", () => {
  const result = inspect({
    "src/core/readings/value.ts":
      "function apply(read: () => number): number { return read(); }\n" +
      "export function value(): number { return apply(() => 7); }\n",
  });
  expect(binding(result)).toEqual([expect.stringMatching(/^R1:callable-binding:src\/core\/readings\/value\.ts:/)]);
});

test.each([
  ["private", "", false],
  ["exported", "export ", true],
] as const)("a registered adapter's %s helper respects its module boundary", (_, visibility, rejected) => {
  const result = inspect({
    "src/substrate/adapters/clock.ts":
      "export interface Clock { now(): number; }\n" +
      "export const clock: Clock = { now: () => Date.now() };\n" +
      `${visibility}function apply(read: () => number): number { return read(); }\n` +
      "export function run(read: () => number): number { return apply(read); }\n",
  });
  if (rejected)
    expect(binding(result)).toEqual([expect.stringMatching(/^R1:callable-binding:src\/substrate\/adapters\/clock\.ts:/)]);
  else expect(binding(result)).toEqual([]);
});

test("an unregistered adapter's private helper still requires an established callback", () => {
  const result = inspect({
    "src/substrate/adapters/unknown.ts":
      "function apply(read: () => number): number { return read(); }\n" +
      "export function run(read: () => number): number { return apply(read); }\n",
  });
  expect(binding(result)).toEqual([expect.stringMatching(/^R1:callable-binding:src\/substrate\/adapters\/unknown\.ts:/)]);
});

test("a registered adapter cannot acquire another adapter's authority through a private helper", () => {
  const result = inspect({
    "src/substrate/adapters/clock.ts":
      "export interface Clock { now(): number; }\n" +
      "function apply(read: () => number): number { return read(); }\n" +
      "export const clock: Clock = { now: () => apply(() => document.createElement('button').childElementCount) };\n",
  });
  expect(result.findings.map((finding) => finding.debtKey)).toContain(
    "R1:raw-primitive:src/substrate/adapters/clock.ts:dom.render",
  );
});

test("a caller supplying unknown behavior to a registered adapter still crosses a checked boundary", () => {
  const result = inspect({
    "src/substrate/adapters/clock.ts":
      "export interface Clock { now(): number; }\n" +
      "function apply(read: () => number): number { return read(); }\n" +
      "export const clock: Clock = { now: () => Date.now() };\n" +
      "export function run(read: () => number): number { return apply(read); }\n",
    [store]:
      "import { run } from '../adapters/clock.js';\n" +
      "export function use(read: () => number): number { return run(read); }\n",
  });
  expect(binding(result)).toEqual([
    expect.stringMatching(/^R1:callable-binding:src\/substrate\/compositions\/store\.ts:src\/substrate\/adapters\/clock\.ts:/),
  ]);
});
