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

const sdkAdapter = "src/shell/adapters/browser.ts";
const sdkClock: NonNullable<KitConfig["adapters"]>[number] = {
  module: "shell/adapters/clock",
  export: "clock",
  capability: "clock",
  kind: "external",
  zones: ["shell"],
  globals: ["Date"],
  primitives: ["clock"],
};
const sdkRegistration: NonNullable<KitConfig["adapters"]> = [
  {
    module: "shell/adapters/browser",
    export: "title",
    capability: "rendering",
    kind: "external",
    zones: ["shell"],
    contract: { parameter: 0 },
  },
  sdkClock,
];
const sdkImport = "import type { Page } from 'browser-sdk';\n";
const sdkCall = "import { title } from '../src/shell/adapters/browser.js';\n";

function inspectSdk(files: Readonly<Record<string, string>>, config: Partial<KitConfig> = {}) {
  const snapshot = sourceFixture(
    {
      "node_modules/browser-sdk/index.d.ts":
        "export interface Page { title(): string; evaluate(read: () => number): number; }\n",
      [sdkAdapter]: sdkImport + "export function title(page: Page): string { return page.title(); }\n",
      "src/shell/adapters/clock.ts": "export const clock = { now: (): number => Date.now() };\n",
      ...files,
    },
    { layout: { legacy: ["legacy"] }, adapters: sdkRegistration, ...config },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return { snapshot, findings: capabilityCheck(snapshot).findings };
}

function expectMigrationOnly(findings: ReturnType<typeof capabilityCheck>["findings"], keys: string[]) {
  expect([...findings].sort((a, b) => a.debtKey.localeCompare(b.debtKey))).toEqual(
    [...keys].sort().map((debtKey) => expect.objectContaining({
      debtKey, status: "unresolved", category: "checker-limit",
    })),
  );
}

test("an explicitly selected SDK input uses its canonical declaration without unrelated module authority", () => {
  const { snapshot, findings } = inspectSdk({
    "legacy/helper.ts":
      sdkImport + sdkCall +
      "import { clock } from '../src/shell/adapters/clock.js';\n" +
      "export function unrelated(): number { return clock.now(); }\n" +
      "export function read(page: Page): string { return title(page); }\n",
  });
  expect(snapshot.compiler?.projects.flatMap((project) => project.contracts)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: sdkAdapter,
        name: "title",
        parameter: 0,
        type: { file: "node_modules/browser-sdk/index.d.ts", name: "Page" },
      }),
    ]),
  );
  expectMigrationOnly(findings, [
    "R1:migration-zone:legacy/helper.ts:src/shell/adapters/browser.ts",
    "R1:migration-zone:legacy/helper.ts:src/shell/adapters/clock.ts",
  ]);
});

test("one canonical SDK input may serve two adapters without inheriting both named capabilities", () => {
  expectMigrationOnly(inspectSdk({
    "src/shell/adapters/network.ts": sdkImport +
      "export function request(page: Page): string { return page.title(); }\n",
    "legacy/helper.ts": sdkImport + sdkCall +
      "export function read(page: Page): string { return title(page); }\n",
  }, { adapters: [...sdkRegistration, {
    module: "shell/adapters/network", export: "request", capability: "network",
    kind: "external", zones: ["shell"], contract: { parameter: 0 },
  }] }).findings, ["R1:migration-zone:legacy/helper.ts:src/shell/adapters/browser.ts"]);
});

test("a re-export and renamed import preserve the canonical SDK input identity", () => {
  expectMigrationOnly(inspectSdk({
    "legacy/sdk.ts": "export type { Page as HostPage } from 'browser-sdk';\n",
    [sdkAdapter]: "import type { HostPage } from '../../../legacy/sdk.js';\n" +
      "export function title(page: HostPage): string { return page.title(); }\n",
    "legacy/helper.ts": "import type { HostPage } from './sdk.js';\n" + sdkCall +
      "export function read(page: HostPage): string { return title(page); }\n",
  }).findings, [
    "R1:migration-zone:legacy/helper.ts:src/shell/adapters/browser.ts",
    "R1:migration-zone:src/shell/adapters/browser.ts:legacy/sdk.ts",
  ]);
});

test("an SDK input is not Window-only merely because its declaration is outside the worker library", () => {
  expect(inspectSdk({
    [sdkAdapter]: "export {};\n",
    "src/substrate/adapters/browser.ts": sdkImport +
      "export function title(page: Page): string { return page.title(); }\n",
    "src/substrate/compositions/read.ts": sdkImport +
      "import { title } from '../adapters/browser.js';\n" +
      "export function read(page: Page): string { return title(page); }\n",
  }, { adapters: [sdkClock, {
    module: "substrate/adapters/browser", export: "title", capability: "remote.read",
    kind: "external", zones: ["substrate"], contract: { parameter: 0 },
  }] }).findings).toEqual([]);
});

test.each(["src/core/compositions/read.ts", "src/shell/readings/read.ts"])(
  "an external SDK contract does not grant native operation inputs to %s",
  (path) => {
    expect(inspectSdk({ [path]: sdkImport +
      "export function read(page: Page): string { return page.title(); }\n",
    }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ path, blocking: true })]));
  },
);

test("a declared legacy zone cannot consume another zone's SDK adapter", () => {
  const path = "legacy/helper.ts";
  expect(inspectSdk({ [path]: sdkImport + sdkCall +
    "export function read(page: Page): string { return title(page); }\n",
  }, { legacyZones: [{ root: "legacy", zone: "substrate" }] }).findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ path, blocking: true })]),
  );
});

test.each(["mutation", "literal"])("a typed SDK %s cannot hide a retained clock callback", (kind) => {
  const path = "legacy/helper.ts";
  const body = kind === "mutation"
    ? "export function read(page: Page): string { page.title = () => String(clock.now()); return title(page); }\n"
    : "export function read(): string { const page: Page = { title: () => String(clock.now()), evaluate: read => read() }; return title(page); }\n";
  expect(inspectSdk({ [path]: sdkImport + sdkCall +
    "import { clock } from '../src/shell/adapters/clock.js';\n" + body,
  }).findings).toEqual(expect.arrayContaining([expect.objectContaining({
    path: sdkAdapter, blocking: true,
    debtKey: expect.stringMatching(/closure-binding:.*:legacy\/helper\.ts:.*:clock$/),
  })]));
});

test("a known SDK input does not establish an unknown callback assigned into it", () => {
  const path = "legacy/helper.ts";
  expect(inspectSdk({ [path]: sdkImport + sdkCall +
    "export function read(page: Page, unknown: () => string): string { page.title = unknown; return title(page); }\n",
  }).findings).toEqual(expect.arrayContaining([expect.objectContaining({
    path: sdkAdapter, blocking: true,
    debtKey: expect.stringMatching(/callable-binding:.*:legacy\/helper\.ts:/),
  })]));
});

test("passing a callback into a native receiver before the adapter boundary retains its authority", () => {
  const path = "legacy/helper.ts";
  expect(inspectSdk({ [path]: sdkImport + sdkCall +
    "import { clock } from '../src/shell/adapters/clock.js';\n" +
    "export function read(page: Page): string { page.evaluate(() => clock.now()); return title(page); }\n",
  }).findings).toEqual(expect.arrayContaining([expect.objectContaining({
    path: sdkAdapter, blocking: true,
    debtKey: expect.stringMatching(/closure-binding:.*:legacy\/helper\.ts:.*:clock$/),
  })]));
});

test("awaiting a shared gesture does not prove an opaque SDK receiver released its callback", () => {
  expect(inspectSdk({
    "legacy/gesture.ts": sdkImport +
      "import { clock } from '../src/shell/adapters/clock.js';\n" +
      "export async function gesture(page: Page): Promise<void> { await page.evaluate(() => clock.now()); }\n",
    "legacy/helper.ts": sdkImport + sdkCall +
      "export function read(page: Page): string { return title(page); }\n",
    "legacy/claim.ts": sdkImport +
      "import { gesture } from './gesture.js';\n" +
      "import { read } from './helper.js';\n" +
      "export async function claim(page: Page): Promise<string> { await gesture(page); return read(page); }\n",
  }).findings).toEqual(expect.arrayContaining([expect.objectContaining({
    path: sdkAdapter, blocking: true,
    debtKey: expect.stringMatching(/closure-binding:.*:legacy\/helper\.ts:.*:clock$/),
  })]));
});

test("an adapter's own native callback is not treated as a callback supplied by its caller", () => {
  expectMigrationOnly(inspectSdk({
    [sdkAdapter]: sdkImport +
      "export function title(page: Page): string { return String(page.evaluate(() => document.title.length)); }\n",
    "legacy/helper.ts": sdkImport + sdkCall +
      "export function read(page: Page): string { return title(page); }\n",
  }, { adapters: [sdkClock, {
    module: "shell/adapters/browser", export: "title", capability: "rendering",
    kind: "external", zones: ["shell"], contract: { parameter: 0 }, globals: ["document"],
  }] }).findings, ["R1:migration-zone:legacy/helper.ts:src/shell/adapters/browser.ts"]);
});

test("a structurally identical SDK declaration does not acquire another package's canonical contract", () => {
  const path = "src/shell/compositions/read.ts";
  expect(inspectSdk({
    "node_modules/other-sdk/index.d.ts":
      "export interface Page { title(): string; evaluate(read: () => number): number; }\n",
    [path]: "import type { Page } from 'other-sdk';\n" +
      "import { title } from '../adapters/browser.js';\n" +
      "export function read(page: Page): string { return title(page); }\n",
  }).findings).toEqual(expect.arrayContaining([expect.objectContaining({
    path, blocking: true,
    debtKey: expect.stringMatching(/(?:callable-binding|native-authority):.*src\/shell\/compositions\/read\.ts:/),
  })]));
});

const sdkFactoryFiles = {
  "node_modules/browser-sdk/index.d.ts":
    "export interface Page { title(): string; evaluate(read: () => number): number; }\n" +
    "export declare function open(options?: { read: () => number }): Page;\n",
  "src/shell/adapters/lease.ts":
    "import { open } from 'browser-sdk';\n" + sdkImport +
    "export interface Lease { open(options?: { read: () => number }): Page; }\n" +
    "export const lease: Lease = { open };\n",
};
const sdkFactoryRegistration: NonNullable<KitConfig["adapters"]> = [...sdkRegistration, {
  module: "shell/adapters/lease", export: "lease", capability: "rendering",
  kind: "external", zones: ["shell"], contract: { type: "Lease" }, packages: ["browser-sdk"],
}];

test.each([false, true])("an acquired SDK handle retains its native identity, not acquisition effects: %s", (usesClock) => {
  expectMigrationOnly(inspectSdk({
    ...sdkFactoryFiles,
    "legacy/boot.ts": sdkImport +
      "import { lease } from '../src/shell/adapters/lease.js';\n" +
      "import { clock } from '../src/shell/adapters/clock.js';\n" +
      "export function unrelated(): number { return clock.now(); }\n" +
      "export function boot(): { page: Page } { " +
      (usesClock ? "clock.now(); " : "") + "return { page: lease.open() }; }\n",
    "legacy/helper.ts": sdkCall + "import { boot } from './boot.js';\n" +
      "export function read(): string { return title(boot().page); }\n",
  }, { adapters: sdkFactoryRegistration }).findings, [
    "R1:migration-zone:legacy/boot.ts:src/shell/adapters/clock.ts",
    "R1:migration-zone:legacy/boot.ts:src/shell/adapters/lease.ts",
    "R1:migration-zone:legacy/helper.ts:src/shell/adapters/browser.ts",
  ]);
});

test.each(["factory-options", "typed-literal"])("an acquired SDK handle retains the clock callback in %s", (kind) => {
  const create = kind === "factory-options"
    ? "lease.open({ read: () => clock.now() })"
    : "{ title: () => String(clock.now()), evaluate: (read: () => number) => read() }";
  expect(inspectSdk({
    ...sdkFactoryFiles,
    "src/shell/compositions/boot.ts": sdkImport +
      (kind === "factory-options" ? "import { lease } from '../adapters/lease.js';\n" : "") +
      "import { clock } from '../adapters/clock.js';\n" +
      `export function boot(): { page: Page } { return { page: ${create} }; }\n`,
    "legacy/helper.ts": sdkCall +
      "import { boot } from '../src/shell/compositions/boot.js';\n" +
      "export function read(): string { return title(boot().page); }\n",
  }, { adapters: sdkFactoryRegistration }).findings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      path: sdkAdapter, blocking: true,
      debtKey: expect.stringMatching(/closure-binding:.*:legacy\/helper\.ts:.*:clock$/),
    }),
  ]));
});

test.each([false, true].flatMap((mutated) => [false, true].map((indexed) => ({ mutated, indexed }))))(
  "an SDK method's returned handle retains its receiver's callback state: $mutated/$indexed",
  ({ mutated, indexed }) => {
  const findings = inspectSdk({
    ...sdkFactoryFiles,
    "node_modules/browser-sdk/index.d.ts":
      "export interface Page { title(): string; evaluate(read: () => number): number; clone(): Page; }\n" +
      "export declare function open(options?: { read: () => number }): Page;\n",
    "src/shell/compositions/boot.ts": sdkImport +
      "import { lease } from '../adapters/lease.js';\n" +
      "import { clock } from '../adapters/clock.js';\n" +
      "export function boot(): Page { const page = lease.open(); " +
      (mutated ? "page.title = () => String(clock.now()); " : "") +
      (indexed ? "return page['clone'](); }\n" : "return page.clone(); }\n"),
    "legacy/helper.ts": sdkCall +
      "import { boot } from '../src/shell/compositions/boot.js';\n" +
      "export function read(): string { return title(boot()); }\n",
  }, { adapters: sdkFactoryRegistration }).findings;
  if (mutated) {
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({
      path: sdkAdapter, blocking: true,
      debtKey: expect.stringMatching(/closure-binding:.*:legacy\/helper\.ts:.*:clock$/),
    })]));
  } else {
    expectMigrationOnly(findings, [
      "R1:migration-zone:legacy/helper.ts:src/shell/adapters/browser.ts",
      "R1:migration-zone:legacy/helper.ts:src/shell/compositions/boot.ts",
    ]);
  }
  },
);

test("a later spread cannot hide the retained callbacks of the selected SDK handle", () => {
  expect(inspectSdk({
    ...sdkFactoryFiles,
    "src/shell/compositions/boot.ts": sdkImport +
      "import { lease } from '../adapters/lease.js';\n" +
      "import { clock } from '../adapters/clock.js';\n" +
      "export function boot(): { page: Page } { const clean = lease.open(); " +
      "const extra: Record<string, Page> = { page: { title: () => String(clock.now()), evaluate: read => read() } }; " +
      "return { page: clean, ...extra }; }\n",
    "legacy/helper.ts": sdkCall +
      "import { boot } from '../src/shell/compositions/boot.js';\n" +
      "export function read(): string { return title(boot().page); }\n",
  }, { adapters: sdkFactoryRegistration }).findings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      path: sdkAdapter, blocking: true,
      debtKey: expect.stringMatching(/closure-binding:.*:legacy\/helper\.ts:.*:clock$/),
    }),
  ]));
});

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
      [adapter]: "type HandleTypes = { signal: AbortSignal; controller: AbortController };\n" +
        "type Handles = { [K in keyof HandleTypes]: HandleTypes[K] };\n" +
        "export interface Cancellation { create<K extends keyof Handles>(kind: K): Handles[K]; }\n" +
        "const handles: Handles = { signal: new AbortController().signal, controller: new AbortController() };\n" +
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
