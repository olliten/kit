import { expect, test } from "vitest";
import { termInventory } from "../../src/core/readings/term-inventory.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { snapshotOf } from "../lib/snapshotOf.js";

function concept(name: string, role = "derived", zone = "core"): string {
  return `- **${name}** — The entire module concept.\n  - Role: ${role}\n  - Zone: ${zone}\n  - ${role === "derived" ? "From" : "Of"}: []\n`;
}

function inspect(files: readonly string[], terms: string) {
  return termModel({
    ...snapshotOf({ files, headings: files.map((file) => file.slice(4, -3)) }),
    terms: termInventory(terms).terms,
  });
}

test("a declared whole compound owns its matching role and zone", () => {
  expect(inspect(["src/core/readings/running-total.ts"], concept("running-total"))).toEqual({
    findings: [],
    limits: [],
  });
});

test("known constituent words do not declare an otherwise missing module concept", () => {
  const result = inspect(
    ["src/core/readings/running-total.ts"],
    "- **running** — An ordinary word.\n- **total** — Another ordinary word.\n",
  );
  expect(result.findings.map((finding) => finding.debtKey)).toEqual([
    "R3:term-module:src/core/readings/running-total.ts:missing-owner",
  ]);
});

test.each([
  ["adapter", "core"],
  ["derived", "shell"],
])("a concept declared with the wrong role or zone has no matching home: %s/%s", (role, zone) => {
  const result = inspect(
    ["src/core/readings/running-total.ts"],
    concept("running-total", role, zone),
  );
  expect(result.findings.map((finding) => finding.debtKey)).toContain(
    "R3:term-home:running-total:0",
  );
});

test("declared plural inflection applies to the whole concept without a path exception", () => {
  expect(inspect(["src/core/readings/running-totals.ts"], concept("running-total"))).toEqual({
    findings: [],
    limits: [],
  });
  const misplaced = inspect(["src/core/readings/runnings-total.ts"], concept("running-total"));
  expect(misplaced.findings.map((finding) => finding.debtKey)).toContain(
    "R3:term-home:running-total:0",
  );
});
