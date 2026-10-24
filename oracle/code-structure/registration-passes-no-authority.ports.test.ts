import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const overlay = "src/shell/compositions/capture-overlay.ts";
const adapters: NonNullable<KitConfig["adapters"]> = [
  {
    module: "shell/adapters/capture-driver",
    export: "captureDrivers",
    capability: "browser-driving",
    kind: "external",
    zones: ["shell"],
    contract: { type: "CaptureDrivers" },
  },
  // A capability Shell may not use, so supplied behaviour crosses a checked boundary there.
  {
    module: "substrate/adapters/store",
    export: "store",
    capability: "storage",
    kind: "external",
    zones: ["substrate"],
    contract: { type: "Store" },
  },
];
const files = {
  "src/shell/adapters/capture-driver.ts":
    "export interface CaptureDriver { readonly click: (selector: string) => Promise<void>; readonly title: () => Promise<string>; }\n" +
    "export interface Remote { readonly title: () => Promise<string>; }\n" +
    "export interface CaptureDrivers { of(name: string): Promise<CaptureDriver>; }\n" +
    "export const captureDrivers: CaptureDrivers = { of: async (name) => ({ click: async () => {}, title: async () => name }) };\n",
  "src/substrate/adapters/store.ts": "export interface Store { read(): string; }\nexport const store: Store = { read: () => 'x' };\n",
};

function inspect(extra: Readonly<Record<string, string>>) {
  const snapshot = sourceFixture({ ...files, ...extra }, { adapters });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot);
}

const siblings = (type: string) =>
  `import type { ${type} } from '../adapters/capture-driver.js';\n` +
  `export function open(driver: ${type}): Promise<string> { return driver.title(); }\n` +
  `export function name(driver: ${type}): Promise<string> { return driver.title(); }\n` +
  `export async function driveCapture(driver: ${type}): Promise<string> { return (await open(driver)) + (await name(driver)); }\n`;

test("a port a contract returns passes between placed functions as an established binding", () => {
  const result = inspect({ [overlay]: siblings("CaptureDriver") });
  expect(result.findings).toEqual([]);
  expect(result.requirements.find((row) => row.path === overlay)?.direct).toEqual(["browser-driving"]);
});

test("a record of functions that no contract returns is still supplied behaviour", () => {
  expect(inspect({ [overlay]: siblings("Remote") }).findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(new RegExp(`^R1:callable-binding:${overlay}:`)),
  );
});

test.each([
  ["a core composition", "src/core/compositions/drive.ts", /^R1:zone-authority:src\/core\/compositions\/drive\.ts:browser-driving$/],
  ["a reading", "src/shell/readings/drive.ts", /^R1:reading-(?:authority|callable):src\/shell\/readings\/drive\.ts/],
])("%s still cannot hold the port", (_, path, key) => {
  const findings = inspect({
    [path]:
      `import type { CaptureDriver } from '${path.includes("/core/") ? "../../shell" : ".."}/adapters/capture-driver.js';\n` +
      "export function drive(driver: CaptureDriver): Promise<string> { return driver.title(); }\n",
  }).findings;
  expect(findings.map((item) => item.debtKey)).toContainEqual(expect.stringMatching(key));
});

test("a literal of the port's type keeps what its closures capture", () => {
  const findings = inspect({
    [overlay]: siblings("CaptureDriver"),
    "src/shell/compositions/forge.ts":
      "import type { CaptureDriver } from '../adapters/capture-driver.js';\n" +
      "import { store } from '../../substrate/adapters/store.js';\n" +
      "import { driveCapture } from './capture-overlay.js';\n" +
      "export function forge(): Promise<string> {\n" +
      "  const driver: CaptureDriver = { click: async () => {}, title: async () => store.read() };\n" +
      "  return driveCapture(driver);\n}\n",
  }).findings;
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    expect.stringMatching(/^R1:closure-binding:src\/shell\/compositions\/forge\.ts:src\/shell\/compositions\/capture-overlay\.ts:\d+:storage$/),
  );
});
