import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { behaviourCheck } from "../../src/core/readings/behaviour-check.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedContracts } from "../substrate/compositions/recorded-contracts.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

const journal: NonNullable<KitConfig["adapters"]>[number] = {
  module: "substrate/adapters/journal",
  export: "journal",
  capability: "journal",
  kind: "external",
  zones: ["substrate"],
  contract: { type: "Journal" },
};

// What the behaviour check finds, and what the zone rules find for a contract it leaves to them.
function keys(files: Readonly<Record<string, string>>, adapters = [journal]): string[] {
  const config = { adapters };
  const sources = {
    "src/substrate/adapters/journal.ts":
      "export interface Entry { note(text: string): void; }\n" +
      "export interface Journal { open(): Entry; }\n" +
      "export const journal: Journal = { open: () => ({ note: () => {} }) };\n",
    ...files,
  };
  const snapshot = projectSnapshot(
    { ...recordedImports(sources, config), ...recordedAuthority(sources, config), ...recordedContracts(sources, config) },
    config,
  );
  const context = capabilityContext(snapshot, []);
  return [
    ...behaviourCheck(snapshot),
    ...zoneAuthorityCheck(snapshot, context, authorityGraph(snapshot, context, [], new Set())),
  ].map((item) => item.debtKey);
}

test.each([
  ["a callable parameter", "src/core/compositions/run.ts", "export function run(read: () => number): number { return read(); }\n", "run"],
  ["a record of operations", "src/core/compositions/run.ts", "export interface Ports { read(): number; }\nexport function run(ports: Ports): number { return ports.read(); }\n", "run"],
  ["a returned function taking a callback", "src/core/compositions/make.ts", "export const make = () => (read: () => number): number => read();\n", "make"],
  ["a writable callable field", "src/core/compositions/holder.ts", "export class Holder { handler: () => number = () => 0; }\n", "Holder"],
  ["a mutable array of callables", "src/core/compositions/register.ts", "export const register: (() => number)[] = [];\n", "register"],
  ["a table of operations without a const assertion", "src/core/compositions/ops.ts", "export const OPS = { add: (n: number): number => n + 1 };\n", "OPS"],
  ["a reading outside the core", "src/substrate/readings/apply.ts", "export function apply(read: () => number): number { return read(); }\n", "apply"],
])("an export taking %s in the core or a reading is a finding", (_, path, source, name) => {
  expect(keys({ [path]: source })).toContain(`R1:takes-behaviour:${path}:${name}`);
});

test.each([
  ["data", "src/core/readings/total.ts", "export function total(values: readonly number[]): number { return values.length; }\n"],
  ["a readonly array of callables", "src/core/primitives/listed.ts", "export const listed: readonly (() => number)[] = [];\n"],
  ["a table of operations under a const assertion", "src/core/compositions/ops.ts", "export const OPS = { add: (n: number): number => n + 1, nested: { add: (n: number): number => n + 1 } } as const;\n"],
  ["behaviour in a Substrate composition", "src/substrate/compositions/run.ts", "export function run(read: () => number): number { return read(); }\n"],
])("an export taking %s is no finding", (_, path, source) => {
  expect(keys({ [path]: source }).filter((key) => key.startsWith("R1:takes-behaviour:"))).toEqual([]);
});

test("a registered contract, and a port its operations return, are not behaviour: the zone rules check them", () => {
  const path = "src/core/compositions/record.ts";
  const found = keys({
    [path]:
      "import type { Entry, Journal } from '../../substrate/adapters/journal.js';\n" +
      "export function record(journal: Journal, entry: Entry): void { journal.open().note('a'); entry.note('b'); }\n",
  });
  expect(found.filter((key) => key.startsWith("R1:takes-behaviour:"))).toEqual([]);
  expect(found).toContain(`R1:zone-authority:${path}:journal`);
});

test("the same type unregistered is behaviour", () => {
  const path = "src/core/compositions/record.ts";
  expect(
    keys(
      {
        [path]:
          "import type { Journal } from '../../substrate/adapters/journal.js';\n" +
          "export function record(journal: Journal): void { journal.open(); }\n",
      },
      [],
    ),
  ).toContain(`R1:takes-behaviour:${path}:record`);
});
