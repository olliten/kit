import { expect, test } from "vitest";
import { termInventory } from "../../src/core/readings/term-inventory.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const keys = (files: readonly string[], terms = "") =>
  termModel({
    ...snapshotOf({ files }),
    terms: termInventory(terms).terms,
  }).findings.map((finding) => finding.debtKey);

test("an app without its configured terms file has a finding naming that file", () => {
  expect(keys(["src/core/readings/total.ts"])).toContain("R3:terms-file:spec/terms.md");
});

test("a present terms file, even one still empty, has no terms-file finding", () => {
  expect(keys(["src/core/readings/total.ts", "spec/terms.md"])).not.toContain(
    "R3:terms-file:spec/terms.md",
  );
});

test("supplied terms have no terms-file finding", () => {
  expect(keys(["src/core/readings/total.ts"], "- **total** — The sum.\n")).not.toContain(
    "R3:terms-file:spec/terms.md",
  );
});
