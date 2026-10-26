import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { constructionCheck } from "../../src/core/readings/construction-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedContracts } from "../substrate/compositions/recorded-contracts.js";

const adapter = "src/substrate/adapters/journal.ts";
const registration: NonNullable<KitConfig["adapters"]> = [
  {
    module: "substrate/adapters/journal",
    export: "journal",
    capability: "journal",
    kind: "external",
    zones: ["substrate"],
    contract: { type: "Journal" },
  },
];

function keys(files: Readonly<Record<string, string>>, exceptions: string[] = []): string[] {
  const config = { adapters: registration, exceptions };
  const facts = recordedContracts(
    {
      [adapter]:
        "export interface Entry { note(text: string): void; }\n" +
        "export interface Journal { open(): Entry; }\n" +
        "export const journal: Journal = { open: () => ({ note: () => {} }) };\n",
      ...files,
    },
    config,
  );
  return constructionCheck(projectSnapshot(facts, config), exceptions)
    .map((item) => item.debtKey)
    .filter((key) => key.startsWith("R1:contract-construction:"));
}

const fake = "src/substrate/compositions/fake.ts";

test("the adapter constructs its own contract and ports", () => {
  expect(keys({})).toEqual([]);
});

test.each([
  ["a contract literal", "import type { Journal } from '../adapters/journal.js';\nexport const fake: Journal = { open: () => ({ note: () => {} }) };\n", ["Entry", "Journal"]],
  ["a port literal", "import type { Entry } from '../adapters/journal.js';\nexport const entry: Entry = { note: () => {} };\n", ["Entry"]],
  ["a class implementing the contract", "import type { Entry, Journal } from '../adapters/journal.js';\nexport class Fake implements Journal { open(): Entry { return this.open(); } }\n", ["Journal"]],
])("%s outside the adapter is a finding", (_, source, types) => {
  expect(keys({ [fake]: source })).toEqual(types.map((type) => `R1:contract-construction:${fake}:${type}`));
});

test("a declared entrypoint may construct a test double", () => {
  const proof = "src/start.ts";
  expect(
    keys(
      {
        [proof]:
          "import type { Journal } from './substrate/adapters/journal.js';\nexport const fake: Journal = { open: () => ({ note: () => {} }) };\n",
      },
      [proof],
    ),
  ).toEqual([]);
});
