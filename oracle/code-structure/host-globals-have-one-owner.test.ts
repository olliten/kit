import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const storage = (root: string, name = "storage"): NonNullable<KitConfig["adapters"]>[number] => ({
  module: `${root}/shell/adapters/${name}`,
  export: "storage",
  capability: `${root}.${name}`,
  kind: "external",
  zones: ["shell"],
  contract: { type: "Storage" },
  globals: ["localStorage"],
});
const adapterSource =
  "export interface Storage { read(key: string): string | null; }\n" +
  "export const storage: Storage = { read: (key) => localStorage.getItem(key) };\n";

function inspect(files: Readonly<Record<string, string>>, adapters: NonNullable<KitConfig["adapters"]>) {
  const snapshot = sourceFixture(files, { srcRoot: ["oracle", "src"], adapters });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings;
}

test("in its adapter a browser global is clean", () => {
  expect(inspect({ "src/shell/adapters/storage.ts": adapterSource }, [storage("src")])).toEqual([]);
});

test("the same global in a browser composition outside its adapter is a raw primitive", () => {
  const view = "src/shell/compositions/view.ts";
  expect(
    inspect(
      {
        "src/shell/adapters/storage.ts": adapterSource,
        [view]: "export function view(): string | null { return localStorage.getItem('k'); }\n",
      },
      [storage("src")],
    ),
  ).toContainEqual(expect.objectContaining({ debtKey: `R1:raw-primitive:${view}:src.storage` }));
});

test("a proof-root adapter may own the global in the proof host beside the browser host's owner", () => {
  expect(
    inspect(
      { "src/shell/adapters/storage.ts": adapterSource, "oracle/shell/adapters/storage.ts": adapterSource },
      [storage("src"), storage("oracle")],
    ),
  ).toEqual([]);
});

test("a second owner in the proof host is a finding", () => {
  const findings = inspect(
    {
      "oracle/shell/adapters/storage.ts": adapterSource,
      "oracle/shell/adapters/seed.ts": adapterSource,
    },
    [storage("oracle"), storage("oracle", "seed")],
  );
  expect(findings.map((item) => item.debtKey)).toEqual(
    expect.arrayContaining([
      "R1:host-global-owner:oracle/shell/adapters/seed.ts:localStorage",
      "R1:host-global-owner:oracle/shell/adapters/storage.ts:localStorage",
    ]),
  );
});

test("code in the proof host acquires the global only through the proof host's owner", () => {
  const helper = "oracle/shell/compositions/seed.ts";
  expect(
    inspect(
      {
        "src/shell/adapters/storage.ts": adapterSource,
        [helper]: "export function seed(): string | null { return localStorage.getItem('k'); }\n",
      },
      [storage("src")],
    ).map((item) => item.debtKey),
  ).not.toContain(`R1:raw-primitive:${helper}:src.storage`);
});
