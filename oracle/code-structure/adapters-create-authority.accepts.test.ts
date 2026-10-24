import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const adapter = "oracle/shell/adapters/capture-driver.ts";
const caller = "legacy/full-stack.ts";
const driver =
  "export interface Page { click(selector: string): Promise<void>; title(): Promise<string>; }\n" +
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
  return capabilityCheck(snapshot).findings.filter((item) => !item.debtKey.startsWith("R1:migration-zone:"));
}

const handOver = "export function run(page: Page): Promise<string> { return captureDrivers.of(page).title(); }\n";

test("a page handed to the adapter that accepts it is the adapter's to hold", () => {
  expect(inspect(handOver)).toEqual([]);
});

test("without accepts the same page is an executable input crossing a checked boundary", () => {
  expect(inspect(handOver, drivers()).map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:callable-binding:${adapter}:${caller}:`)),
  );
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
      "  const local: Page = { click: (selector) => page.click(selector + store.read()), title: () => page.title() };\n" +
      "  return captureDrivers.of(local).title();\n}\n",
  );
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:closure-binding:${adapter}:${caller}:${adapter}:\\d+:storage$`)),
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
