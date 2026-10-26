import { expect, test } from "vitest";
import { recordedReach } from "../substrate/compositions/recorded-reach.js";

// What a test reaches, computed on compiled fixtures: its free names followed into declarations, every
// statement that can change a mutable value it holds, the results of calls, `this`, and what can't be followed.
const TEST = "src/reach.test.ts";
const reach = (files: Readonly<Record<string, string>>, test: string) => recordedReach({ ...files, [TEST]: test }, TEST);
const declared = (file: string, ...names: string[]) => names.map((name) => ({ file, name }));

test("a test reaches the declarations its free names use, not the rest of their module", () => {
  expect(
    reach(
      {
        "src/total.ts": [
          "export const total = (n: readonly number[]): number => n.length;",
          "export const average = (n: readonly number[]): number => n.length;",
          "",
        ].join("\n"),
      },
      'import { total } from "./total.js";\nvoid total([]);\n',
    ),
  ).toEqual({
    reached: ["src/reach.test.ts", "src/total.ts"],
    whole: [],
    declarations: declared("src/total.ts", "total"),
  });
});

test("a module a helper imports dynamically can't be followed, so it is charged whole", () => {
  expect(
    reach(
      {
        "src/loader.ts": 'export const load = (): Promise<unknown> => import("./plugin.js");\n',
        "src/plugin.ts": "export const plugin = 1;\n",
      },
      'import { load } from "./loader.js";\nvoid load();\n',
    ),
  ).toEqual({
    reached: ["src/loader.ts", "src/reach.test.ts"],
    whole: ["src/plugin.ts"],
    declarations: declared("src/loader.ts", "load"),
  });
});

test("a name a helper destructures from a call reaches the statement that destructures it and the call", () => {
  expect(
    reach(
      {
        "src/pair.ts": [
          'const make = (): [string[], { readonly name: string }] => [[], { name: "a" }];',
          "const [, { name }] = make();",
          "export const label = (): string => name;",
          "",
        ].join("\n"),
      },
      'import { label } from "./pair.js";\nvoid label();\n',
    ),
  ).toEqual({
    reached: ["src/pair.ts", "src/reach.test.ts"],
    whole: [],
    declarations: declared("src/pair.ts", "label", "make", "name"),
  });
});

test("a value a helper stores into an object the test holds is reached", () => {
  expect(
    reach(
      {
        "src/entry.ts": "export const entry = (): string[] => [];\n",
        "src/store.ts": [
          'import { entry } from "./entry.js";',
          "export const registry: { items: string[] } = { items: [] };",
          "export function fill(): void {",
          "  registry.items = entry();",
          "}",
          "",
        ].join("\n"),
      },
      'import { registry } from "./store.js";\nvoid registry.items.length;\n',
    ),
  ).toEqual({
    reached: ["src/entry.ts", "src/reach.test.ts", "src/store.ts"],
    whole: [],
    declarations: [...declared("src/entry.ts", "entry"), ...declared("src/store.ts", "fill", "registry")],
  });
});

test("a value stored through another holder a held object was copied into is reached", () => {
  expect(
    reach(
      {
        "src/entry.ts": "export const entry = (): string[] => [];\n",
        "src/store.ts": [
          'import { entry } from "./entry.js";',
          "export const registry: { items: string[] } = { items: [] };",
          "export const mirror: { held?: { items: string[] } } = {};",
          "export function keep(): void {",
          "  mirror.held = registry;",
          "}",
          "export function fill(): void {",
          "  if (mirror.held !== undefined) mirror.held.items = entry();",
          "}",
          "",
        ].join("\n"),
      },
      'import { registry } from "./store.js";\nvoid registry.items.length;\n',
    ),
  ).toEqual({
    reached: ["src/entry.ts", "src/reach.test.ts", "src/store.ts"],
    whole: [],
    declarations: [...declared("src/entry.ts", "entry"), ...declared("src/store.ts", "fill", "keep", "registry")],
  });
});

test("what a function returns from a binding the test holds is followed into its callers and wherever it is handed on", () => {
  expect(
    reach(
      {
        "src/added.ts": 'export const added = (): string => "a";\n',
        "src/cache.ts": [
          'import { added } from "./added.js";',
          "const cache: string[] = [];",
          "export function shared(): string[] {",
          "  return cache;",
          "}",
          "export const pick: () => string[] = shared;",
          "export function grow(): void {",
          "  shared().push(added());",
          "}",
          "",
        ].join("\n"),
      },
      'import { shared } from "./cache.js";\nvoid shared().length;\n',
    ),
  ).toEqual({
    reached: ["src/added.ts", "src/cache.ts", "src/reach.test.ts"],
    whole: [],
    declarations: [...declared("src/added.ts", "added"), ...declared("src/cache.ts", "cache", "grow", "pick", "shared")],
  });
});

test("`this` in a method that stores into a held value reaches the class that holds the method", () => {
  expect(
    reach(
      {
        "src/seed.ts": "export const seed = (): string[] => [];\n",
        "src/box.ts": [
          'import { seed } from "./seed.js";',
          "export const shared: string[][] = [];",
          "export class Box {",
          "  items: string[] = seed();",
          "  keep(): void {",
          "    shared.push(this.items);",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
      'import { shared } from "./box.js";\nvoid shared.length;\n',
    ),
  ).toEqual({
    reached: ["src/box.ts", "src/reach.test.ts", "src/seed.ts"],
    whole: [],
    declarations: [...declared("src/box.ts", "Box", "shared"), ...declared("src/seed.ts", "seed")],
  });
});

test("`this` in a plain function can't be followed, so its file is charged whole", () => {
  expect(
    reach(
      {
        "src/log.ts": [
          "export const log: string[] = [];",
          "export function note(this: { readonly name: string }): void {",
          "  log.push(this.name);",
          "}",
          "",
        ].join("\n"),
      },
      'import { log } from "./log.js";\nvoid log.length;\n',
    ),
  ).toEqual({
    reached: ["src/log.ts", "src/reach.test.ts"],
    whole: ["src/log.ts"],
    declarations: declared("src/log.ts", "log", "note"),
  });
});

test.each([
  ["string[]", true],
  ["[string]", true],
  ["readonly [string]", false],
])("a constant of type %s reaches what a helper writes into it: %s", (type, changeable) => {
  const result = reach(
    {
      "src/other.ts": 'export const other = (): string => "b";\n',
      "src/names.ts": [
        'import { other } from "./other.js";',
        `export const names: ${type} = ["a"];`,
        "export function rename(): void {",
        "  (names as unknown as string[]).push(other());",
        "}",
        "",
      ].join("\n"),
    },
    'import { names } from "./names.js";\nvoid names.length;\n',
  );
  expect(result).toEqual(
    changeable
      ? {
          reached: ["src/names.ts", "src/other.ts", "src/reach.test.ts"],
          whole: [],
          declarations: [...declared("src/names.ts", "names", "rename"), ...declared("src/other.ts", "other")],
        }
      : { reached: ["src/names.ts", "src/reach.test.ts"], whole: [], declarations: declared("src/names.ts", "names") },
  );
});
