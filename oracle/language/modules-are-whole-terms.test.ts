import { expect, test } from "vitest";
import type { SpecTerm } from "../../src/core/primitives/term.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

type Module = Extract<NonNullable<SpecTerm["metadata"]>, { kind: "module" }>;

function concept(name: string, role: Module["role"] = "derived", zone: Module["zone"] = "core"): SpecTerm[] {
  const metadata: Module = { kind: "module", role, zone, references: [] };
  return [{ term: name, meaning: "The entire module concept.", retired: [], line: 1, metadata }];
}

function inspect(files: readonly string[], terms: readonly SpecTerm[]) {
  return termModel({ ...snapshotOf({ files }), terms });
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
    [
      { term: "running", meaning: "An ordinary word.", retired: [], line: 1 },
      { term: "total", meaning: "Another ordinary word.", retired: [], line: 2 },
    ],
  );
  expect(result.findings.map((finding) => finding.debtKey)).toEqual([
    "R3:term-module:src/core/readings/running-total.ts:missing-owner",
  ]);
});

test.each<[Module["role"], Module["zone"]]>([
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
