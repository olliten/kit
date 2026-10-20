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
