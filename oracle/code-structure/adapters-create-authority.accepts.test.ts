import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const adapter = "oracle/shell/adapters/capture-driver.ts";
const caller = "legacy/full-stack.ts";
const driver =
  // Like a browser driver's page, its own type graph reaches the DOM's Window.
  "export interface Page { click(selector: string): Promise<void>; title(): Promise<string>; readonly opener: Window | null; }\n" +
  "export interface Locator { text(): Promise<string>; }\n" +
  "export interface Frame { url(): string; }\n";
const drivers = (accepts?: NonNullable<KitConfig["adapters"]>[number]["accepts"]): NonNullable<KitConfig["adapters"]> => [
  {
    module: "oracle/shell/adapters/capture-driver",
    export: "captureDrivers",
    capability: "browser-driving",
    kind: "external",
    zones: ["shell"],
    contract: { type: "CaptureDrivers" },
    ...(accepts === undefined ? {} : { accepts }),
  },
  // A capability Shell may not use, so supplied behaviour crosses a checked boundary there.
  {
    module: "src/substrate/adapters/store",
    export: "store",
    capability: "storage",
    kind: "external",
    zones: ["substrate"],
    contract: { type: "Store" },
  },
];
const accepted = [{ package: "browser-driver", types: ["Page"] }];
const adapterSource = (signature = "of(page: Page): CaptureDriver", body = "of: (page) => ({ title: () => page.title() })") =>
  "import type { Frame, Locator, Page } from 'browser-driver';\n" +
  "export interface CaptureDriver { readonly title: () => Promise<string>; }\n" +
  `export interface CaptureDrivers { ${signature}; }\n` +
  `export const captureDrivers: CaptureDrivers = { ${body} };\n` +
  "export type Handles = Frame | Locator;\n";

function inspect(
  call: string,
  adapters = drivers(accepted),
  source = adapterSource(),
  packages: KitConfig["packages"] = [{ name: "browser-driver", capabilities: ["browser-driving"] }],
) {
  const snapshot = sourceFixture(
    {
      "node_modules/browser-driver/index.d.ts": driver,
      [adapter]: source,
      "src/substrate/adapters/store.ts": "export interface Store { read(): string; }\nexport const store: Store = { read: () => 'x' };\n",
      [caller]:
        "import type { Frame, Locator, Page } from 'browser-driver';\n" +
        "import { captureDrivers } from '../oracle/shell/adapters/capture-driver.js';\n" +
        call,
    },
    { srcRoot: ["oracle", "src"], layout: { legacy: ["legacy"] }, adapters, packages },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  // The legacy caller's own migration limits and raw reads stay its own; the rules under test are about the hand-over.
  return capabilityCheck(snapshot).findings.filter(
    (item) => !item.debtKey.startsWith("R1:migration-zone:") && item.path !== caller,
  );
}

const handOver =
  "import { store } from '../src/substrate/adapters/store.js';\n" +
  "export function stamp(): string { return store.read() + String(Date.now()); }\n" +
  "export const run = (page: Page): Promise<string> => captureDrivers.of(page).title();\n";

test("a page handed to the adapter that accepts it is the adapter's to hold", () => {
  expect(inspect(handOver)).toEqual([]);
});

test("without accepts the same page is an executable input carrying its Window into the adapter", () => {
  const keys = inspect(handOver, drivers()).map((item) => item.debtKey);
  expect(keys).toContainEqual(expect.stringMatching(new RegExp(`^R1:callable-binding:${adapter}:${caller}:`)));
  expect(keys).toContainEqual(expect.stringMatching(new RegExp(`^R1:native-authority:${adapter}:${caller}:.*:Window$`)));
});

test("the port the adapter returns carries the page's roots into a placed composition only with accepts", () => {
  const overlay = "oracle/shell/compositions/capture-overlay.ts";
  const files = {
    [overlay]:
      "import type { CaptureDriver } from '../adapters/capture-driver.js';\n" +
      "export async function open(page: CaptureDriver): Promise<string> { return page.title(); }\n" +
      "export async function driveCapture(page: CaptureDriver): Promise<string> { return open(page); }\n",
  };
  const call =
    "import * as overlay from '../oracle/shell/compositions/capture-overlay.js';\n" +
    "export const open = (page: Page): Promise<string> => overlay.driveCapture(captureDrivers.of(page));\n";
  const snapshot = (adapters: NonNullable<KitConfig["adapters"]>) =>
    capabilityCheck(sourceFixture(
      {
        "node_modules/browser-driver/index.d.ts": driver,
        [adapter]: adapterSource(),
        ...files,
        "src/substrate/adapters/store.ts": "export interface Store { read(): string; }\nexport const store: Store = { read: () => 'x' };\n",
        [caller]: "import type { Page } from 'browser-driver';\nimport { captureDrivers } from '../oracle/shell/adapters/capture-driver.js';\n" + call,
      },
      {
        srcRoot: ["oracle", "src"],
        layout: { legacy: ["legacy"] },
        adapters,
        packages: [{ name: "browser-driver", capabilities: ["browser-driving"] }],
      },
    )).findings.filter((item) => item.path === overlay);
  expect(snapshot(drivers()).map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:callable-binding:${overlay}:${caller}:`)),
  );
  expect(snapshot(drivers(accepted))).toEqual([]);
});

test("another argument of a type the adapter does not accept stays checked", () => {
  const findings = inspect(
    "export function run(page: Page, frame: Frame): Promise<string> { return captureDrivers.of(page, frame).title(); }\n",
    drivers(accepted),
    adapterSource("of(page: Page, frame: Frame): CaptureDriver", "of: (page, frame) => ({ title: () => page.title().then((t) => t + frame.url()) })"),
  );
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:callable-binding:${adapter}:${caller}:`)),
  );
});

test("a package type the adapter did not declare is not accepted", () => {
  const findings = inspect(
    "export function run(locator: Locator): Promise<string> { return captureDrivers.of(locator).title(); }\n",
    drivers(accepted),
    adapterSource("of(locator: Locator): CaptureDriver", "of: (locator) => ({ title: () => locator.text() })"),
  );
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:callable-binding:${adapter}:${caller}:`)),
  );
});

test("a handle the caller builds keeps the caller's own authority", () => {
  const findings = inspect(
    "import { store } from '../src/substrate/adapters/store.js';\n" +
      "export function run(page: Page): Promise<string> {\n" +
      "  const local: Page = { click: (selector) => page.click(selector + store.read()), title: () => page.title(), opener: null };\n" +
      "  return captureDrivers.of(local).title();\n}\n",
  );
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:closure-binding:${adapter}:${caller}:${adapter}:\\d+:storage$`)),
  );
});

test.each([
  ["document", "document.title"],
  ["localStorage", "localStorage.getItem('k') ?? ''"],
  ["window, which the page's own graph also reaches", "window.name"],
  ["window.localStorage", "window.localStorage.getItem('k') ?? ''"],
])("a caller's handle literal capturing %s keeps that host global its own", (_, read) => {
  const findings = inspect(
    "export function run(page: Page): Promise<string> {\n" +
      `  const local: Page = { click: (selector) => page.click(selector), title: async () => ${read}, opener: null };\n` +
      "  return captureDrivers.of(local).title();\n}\n",
  );
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:(?:closure-binding|native-authority):${adapter}:${caller}:${adapter}:\\d+:`)),
  );
});

test("accepting a handle adds nothing to what the adapter's own code may reach", () => {
  // The adapter's own natives: a contract whose types mention Window already covers Window-rooted access, as
  // on main; accepts must not widen that, and Storage stays undeclared either way.
  const body = "of: (page) => ({ title: async () => (await page.title()) + window.name + (window.localStorage.getItem('k') ?? '') })";
  const own = (adapters: NonNullable<KitConfig["adapters"]>) =>
    inspect(handOver, adapters, adapterSource(undefined, body))
      .map((item) => item.debtKey)
      .filter((key) => key.startsWith(`R1:native-authority:${adapter}:native:`));
  expect(own(drivers(accepted))).toEqual(own(drivers()));
  expect(own(drivers(accepted))).toContainEqual(expect.stringMatching(/lib\.dom\.d\.ts:Storage$/));
});

test("accepting a handle grants the adapter no undeclared host global", () => {
  const findings = inspect(
    handOver,
    drivers(accepted),
    adapterSource(undefined, "of: (page) => ({ title: async () => (await page.title()) + (window.localStorage.getItem('k') ?? '') })"),
  );
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:native-authority:${adapter}:native:.*lib\\.dom\\.d\\.ts:(?:Storage|Window)$`)),
  );
});

test.each([
  ["a non-external adapter", [{ ...drivers()[0]!, kind: "apply" as const, accepts: accepted }]],
  ["an undeclared package", drivers([{ package: "other-driver", types: ["Page"] }])],
  ["no types", drivers([{ package: "browser-driver", types: [] }])],
  ["repeated types", drivers([{ package: "browser-driver", types: ["Page", "Page"] }])],
  ["a relative package", drivers([{ package: "./driver", types: ["Page"] }])],
])("accepts on %s is a configuration error", (_, adapters) => {
  expect(() => inspect(handOver, adapters)).toThrow(/accepts/);
});
