import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { handoverCheck } from "../../src/core/readings/handover-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

import { ratchetFindings } from "../../src/core/readings/ratchet.js";

const run = "src/substrate/compositions/run.ts";
const store = "src/substrate/compositions/store.ts";

function boundary(
  caller: string,
  config: Partial<KitConfig> = {},
  extra: Readonly<Record<string, string>> = {},
) {
  const snapshot = sourceFixture(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          types: ["node"],
          typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts", "legacy/**/*.ts"],
      }),
      "package.json": JSON.stringify({ type: "module" }),
      [run]:
        "import type { Journal } from '../adapters/journal.js';\n" +
        "export interface Ports { read(): string; write(value: string): void; }\n" +
        "export function run(read: () => string, write: (value: string) => void): void { write(read()); }\n" +
        "export function runRecord(ports: Ports): void { ports.write(ports.read()); }\n" +
        "export function record(journal: Journal): void { journal.note('ran'); }\n" +
        "export function total(values: readonly number[]): number { return values.reduce((a, b) => a + b, 0); }\n" +
        "export const make = () => (read: () => string): string => read();\n",
      [store]:
        "export class Holder {\n  handler: () => string = () => '';\n  value(): string { return this.handler(); }\n}\n" +
        "export class Settings {\n  readonly name: string = '';\n  readonly size: number = 0;\n}\n" +
        "export const holder: Holder = new Holder();\n" +
        "export const register: (() => string)[] = [];\n" +
        "export const listed: readonly (() => string)[] = [];\n",
      "src/substrate/adapters/journal.ts":
        "export interface Journal { note(text: string): void; }\nexport const journal: Journal = { note: () => {} };\n",
      "legacy/index.ts": caller,
      ...extra,
    },
    { layout: { legacy: ["legacy"] }, ...config },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return handoverCheck(snapshot);
}

const keys = (caller: string): string[] => boundary(caller).map((item) => item.debtKey);
const key = (target: string, name: string): string => `R1:handover:legacy/index.ts:${target}#${name}`;

test.each([
  ["separate callables", "import { run } from '../src/substrate/compositions/run.js';\nrun(() => '', () => {});\n", run, "run"],
  ["a record of functions", "import { runRecord } from '../src/substrate/compositions/run.js';\nvoid runRecord;\n", run, "runRecord"],
  ["an adapter contract", "import { record } from '../src/substrate/compositions/run.js';\nvoid record;\n", run, "record"],
  ["a returned function", "import { make } from '../src/substrate/compositions/run.js';\nmake()(() => '');\n", run, "make"],
  ["a class with a writable callable field", "import { Holder } from '../src/substrate/compositions/store.js';\nvoid Holder;\n", store, "Holder"],
  ["an instance with a writable callable field", "import { holder } from '../src/substrate/compositions/store.js';\nholder.handler = () => '';\n", store, "holder"],
  ["a mutable array of callables", "import { register } from '../src/substrate/compositions/store.js';\nregister.push(() => '');\n", store, "register"],
])("a legacy import of a placed export taking %s is legacy debt", (_, caller, target, name) => {
  const findings = boundary(caller);
  expect(findings.map((item) => item.debtKey)).toEqual([key(target, name)]);
  expect(findings.every((item) => item.category === "legacy-debt")).toBe(true);
});

test.each([
  ["a data parameter", "import { total } from '../src/substrate/compositions/run.js';\ntotal([1]);\n"],
  ["a readonly class", "import { Settings } from '../src/substrate/compositions/store.js';\nvoid new Settings();\n"],
  ["a readonly array of callables", "import { listed } from '../src/substrate/compositions/store.js';\nvoid listed;\n"],
  ["a type-only import", "import type { Ports } from '../src/substrate/compositions/run.js';\nexport const ports: Ports | null = null;\n"],
  ["an adapter's own export", "import { journal } from '../src/substrate/adapters/journal.js';\njournal.note('a');\n"],
])("a legacy import of %s is no debt", (_, caller) => {
  expect(keys(caller)).toEqual([]);
});

test("a namespace import answers for every export that takes behaviour", () => {
  expect(keys("import * as all from '../src/substrate/compositions/run.js';\nvoid all;\n")).toEqual(
    ["make", "record", "run", "runRecord"].map((name) => key(run, name)),
  );
});

test("a baseline holds existing boundary debt, and a new crossing fails", () => {
  const before = boundary("import { run } from '../src/substrate/compositions/run.js';\nvoid run;\n");
  const baseline = before.map((item) => item.debtKey);
  expect(ratchetFindings(before, baseline, [], [])).toEqual([]);
  const after = boundary(
    "import { run, record } from '../src/substrate/compositions/run.js';\nvoid run;\nvoid record;\n",
  );
  expect(ratchetFindings(after, baseline, [], []).map((item: { debtKey: string }) => item.debtKey)).toEqual([
    key(run, "record"),
  ]);
});

test("a registered contract crosses, and a declared entrypoint's crossing is a violation", () => {
  const adapters: NonNullable<KitConfig["adapters"]> = [
    {
      module: "substrate/adapters/journal",
      export: "journal",
      capability: "journal",
      kind: "external",
      zones: ["substrate"],
      contract: { type: "Journal" },
    },
  ];
  const caller = "import { record, run } from '../src/substrate/compositions/run.js';\nvoid record;\nvoid run;\n";
  expect(boundary(caller, { adapters }).map((item) => item.debtKey)).toEqual([key(run, "run")]);
  const start = "legacy/index.ts";
  expect(boundary(caller, { adapters, exceptions: [start] }).map((item) => item.category)).toEqual([
    "placed-violation",
  ]);
});

test("a package handle crosses only into the adapter that declares its package", () => {
  const sdk = "src/shell/adapters/browser.ts";
  const files = {
    "node_modules/browser-sdk/index.d.ts": "export interface Page { title(): string; }\n",
    "node_modules/browser-sdk/package.json": JSON.stringify({ name: "browser-sdk", types: "index.d.ts" }),
    [sdk]: "import type { Page } from 'browser-sdk';\nexport function title(page: Page): string { return page.title(); }\n",
  };
  const caller = "import { title } from '../src/shell/adapters/browser.js';\nvoid title;\n";
  const adapter = (packages: string[]): NonNullable<KitConfig["adapters"]> => [
    { module: "shell/adapters/browser", export: "title", capability: "rendering", kind: "external", zones: ["shell"], packages },
  ];
  expect(boundary(caller, { adapters: adapter(["browser-sdk"]) }, files)).toEqual([]);
  expect(boundary(caller, { adapters: adapter([]) }, files).map((item) => item.debtKey)).toEqual([
    `R1:handover:legacy/index.ts:${sdk}#title`,
  ]);
});
