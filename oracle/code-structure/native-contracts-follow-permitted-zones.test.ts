import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const adapter = "src/substrate/adapters/cancellation.ts";
const contract =
  "export interface Cancellation { signal(): AbortSignal; }\n" +
  "export const cancellation: Cancellation = { signal: () => new AbortController().signal };\n";
const registration: NonNullable<KitConfig["adapters"]> = [
  {
    module: "substrate/adapters/cancellation",
    export: "cancellation",
    capability: "cancellation",
    kind: "external",
    zones: ["substrate"],
    contract: { type: "Cancellation" },
    globals: ["AbortController"],
  },
];

function inspect(files: Readonly<Record<string, string>>, adapters = registration) {
  const snapshot = sourceFixture({ [adapter]: contract, ...files }, { adapters });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings;
}

test("a real declared Substrate native contract is usable in its permitted composition", () => {
  expect(
    inspect({
      "src/substrate/compositions/read.ts":
        "import { cancellation } from '../adapters/cancellation.js';\n" +
        "export function read(): boolean { return cancellation.signal().aborted; }\n",
    }),
  ).toEqual([]);
});

test("the same registered native contract remains forbidden in Core", () => {
  const path = "src/core/compositions/read.ts";
  expect(
    inspect({
      [path]: "export function read(signal: AbortSignal): boolean { return signal.aborted; }\n",
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ path, blocking: true })]));
});

test("declaring a native contract does not grant it to readings", () => {
  const path = "src/substrate/readings/read.ts";
  expect(
    inspect({
      [path]: "export function read(signal: AbortSignal): boolean { return signal.aborted; }\n",
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ path, blocking: true })]));
});

test.each(["direct", "alias", "closure"])(
  "unregistered native authority remains rejected through %s use",
  (kind) => {
    const path = "src/substrate/compositions/read.ts";
    const body =
      kind === "alias"
        ? "type Control = HTMLElement;\nexport function read(element: Control): void { element.focus(); }\n"
        : kind === "closure"
          ? "export function read(element: HTMLElement): () => void { return () => element.focus(); }\n"
          : "export function read(element: HTMLElement): void { element.focus(); }\n";
    expect(inspect({ [path]: body })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: expect.stringContaining("R1:native-authority:"),
          path,
          blocking: true,
        }),
      ]),
    );
  },
);

test("a registered native callback cannot be retained and passed into Core", () => {
  expect(
    inspect({
      "src/core/compositions/run.ts":
        "export function run(read: () => boolean): boolean { return read(); }\n",
      "src/substrate/compositions/read.ts":
        "import { cancellation } from '../adapters/cancellation.js';\nimport { run } from '../../core/compositions/run.js';\n" +
        "export function read(): boolean { const signal = cancellation.signal(); const retained = () => signal.aborted; return run(retained); }\n",
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringMatching(
          /^R1:closure-binding:src\/substrate\/compositions\/read\.ts:src\/core\/compositions\/run\.ts:\d+:cancellation$/,
        ),
        path: "src/substrate/compositions/read.ts",
        status: "violation",
        category: "placed-violation",
        blocking: true,
      }),
    ]),
  );
});

const renderingAdapter = "src/shell/adapters/rendering.ts";
const genericRendering =
  "export interface Rendering { create<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K]; }\n" +
  "export const rendering: Rendering = { create: (tag) => document.createElement(tag) };\n";
const renderingRegistration: NonNullable<KitConfig["adapters"]> = [
  {
    module: "shell/adapters/rendering",
    export: "rendering",
    capability: "rendering",
    kind: "external",
    zones: ["shell"],
    contract: { type: "Rendering" },
    globals: ["document"],
  },
];

function inspectRendering(files: Readonly<Record<string, string>>, body = genericRendering) {
  const snapshot = sourceFixture({ [renderingAdapter]: body, ...files }, { adapters: renderingRegistration });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings;
}

test.each([
  "export function text(): string { return rendering.create('p').textContent ?? ''; }\n",
  "function paragraph(): HTMLParagraphElement { return rendering.create('p'); }\n" +
    "export function text(): string { return paragraph().textContent ?? ''; }\n",
])("a generic element factory establishes its concrete Shell handle contract: %s", (body) => {
  expect(
    inspectRendering({
      "src/shell/compositions/text.ts": "import { rendering } from '../adapters/rendering.js';\n" + body,
    }),
  ).toEqual([]);
});

test.each(["src/core/compositions/text.ts", "src/shell/readings/text.ts"])(
  "a generic Shell contract does not grant its native handles to %s",
  (path) => {
    expect(
      inspectRendering({
        [path]: "export function text(paragraph: HTMLParagraphElement): string { return paragraph.textContent ?? ''; }\n",
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path, blocking: true })]));
  },
);

test.each([
  { type: "Document", operation: "document" },
  { type: "HTMLDivElement", operation: "document.createElement('div')" },
])("a contract exposing only $type does not authorize an unrelated paragraph handle", ({ type, operation }) => {
  const path = "src/shell/compositions/text.ts";
  expect(
    inspectRendering(
      { [path]: "export function text(paragraph: HTMLParagraphElement): string { return paragraph.textContent ?? ''; }\n" },
      `export interface Rendering { create(): ${type}; }\n` +
        `export const rendering: Rendering = { create: () => ${operation} };\n`,
    ),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ path, blocking: true })]));
});

test("an element factory does not authorize an escaped owner document", () => {
  const path = "src/shell/compositions/text.ts";
  expect(
    inspectRendering({
      [path]: "import { rendering } from '../adapters/rendering.js';\n" +
        "export function owner(): string { return rendering.create('p').ownerDocument.documentElement.tagName; }\n",
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ path, blocking: true })]));
});

test("an unresolved indexed generic contract grants no native paragraph authority", () => {
  const path = "src/shell/compositions/text.ts";
  expect(
    inspectRendering(
      { [path]: "export function text(paragraph: HTMLParagraphElement): string { return paragraph.textContent ?? ''; }\n" },
      "export interface Rendering { read<K extends string>(name: K): Record<K, unknown>[K]; }\n" +
        "export const rendering: Rendering = { read: () => undefined };\n",
    ),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ path, blocking: true })]));
});

test("an indexed mapped contract establishes its shared cancellation handle in Substrate", () => {
  expect(
    inspect({
      [adapter]: "type Handles = { [K in 'signal']: AbortSignal };\n" +
        "export interface Cancellation { create<K extends keyof Handles>(kind: K): Handles[K]; }\n" +
        "const handles: Handles = { signal: new AbortController().signal };\n" +
        "export const cancellation: Cancellation = { create: (kind) => handles[kind] };\n",
      "src/substrate/compositions/read.ts":
        "import { cancellation } from '../adapters/cancellation.js';\n" +
        "function signal(): AbortSignal { return cancellation.create('signal'); }\n" +
        "export function read(): boolean { return signal().aborted; }\n",
    }),
  ).toEqual([]);
});

test("an indexed mapped Window contract stays forbidden in Substrate", () => {
  const path = "src/substrate/compositions/read.ts";
  const snapshot = sourceFixture({
    "src/substrate/adapters/view.ts":
      "type Handles = { [K in 'view']: Window };\n" +
      "export interface View { create<K extends keyof Handles>(kind: K): Handles[K]; }\n" +
      "const handles: Handles = { view: window };\n" +
      "export const view: View = { create: (kind) => handles[kind] };\n",
    [path]: "import { view } from '../adapters/view.js';\n" +
      "export function read(): Window { return view.create('view'); }\n",
  }, {
    adapters: [{
      module: "substrate/adapters/view",
      export: "view",
      capability: "view",
      kind: "external",
      zones: ["substrate"],
      contract: { type: "View" },
      globals: ["window"],
    }],
  });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  expect(capabilityCheck(snapshot).findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ path, blocking: true })]),
  );
});
