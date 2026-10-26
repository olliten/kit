import { expect, test } from "vitest";

import { ratchetFindings } from "../../src/core/readings/ratchet.js";

function finding(
  category: "legacy-debt" | "checker-limit" | "placed-violation",
  path: string,
  debtKey: string,
) {
  return {
    rule: "R1" as const,
    path,
    debtKey,
    fix: "Restore this architectural boundary.",
    status: category === "checker-limit" ? "unresolved" : "violation",
    category,
    blocking: true,
    limit: category === "checker-limit" ? "Package authority is not configured." : "",
  };
}

test("known legacy debt may remain while a new legacy cause fails", () => {
  const known = finding("legacy-debt", "src/old/value.ts", "R1:raw:old");
  const added = finding("legacy-debt", "src/old/new.ts", "R1:raw:new");
  expect(ratchetFindings([known, added], [known.debtKey], [], [])).toEqual([added]);
});

test("a placed violation cannot be waived by putting its key in the legacy baseline", () => {
  const actual = finding("placed-violation", "src/core/readings/value.ts", "R1:placed:value");
  expect(ratchetFindings([actual], [actual.debtKey], [actual.path], [])).toEqual([actual]);
});

test("an unrelated legacy checker limit remains reportable without becoming legacy debt", () => {
  const limit = finding("checker-limit", "src/old/external.ts", "R1:package:old");
  const input = [limit];
  expect(ratchetFindings(input, [], ["src/core/readings/value.ts"], [])).toEqual([]);
  expect(input).toEqual([limit]);
  expect(limit.category).toBe("checker-limit");
});

test("a directly placed checker limit cannot be waived by a baseline key", () => {
  const limit = finding("checker-limit", "src/shell/compositions/editor.ts", "R1:package:editor");
  expect(ratchetFindings([limit], [limit.debtKey], [limit.path], [])).toEqual([limit]);
});

test("a transitive legacy checker limit fails even if its key appears in the baseline", () => {
  const limit = finding("checker-limit", "src/old/external.ts", "R1:package:old");
  const imports = [
    { from: "src/shell/compositions/editor.ts", to: "src/old/helper.ts" },
    { from: "src/old/helper.ts", to: limit.path },
  ];
  expect(ratchetFindings([limit], [limit.debtKey], [imports[0]?.from ?? ""], imports)).toEqual([
    limit,
  ]);
});

test("reachable dependency cycles terminate and do not hide a checker limit", () => {
  const limit = finding("checker-limit", "src/old/external.ts", "R1:package:old");
  const imports = [
    { from: "src/core/compositions/change.ts", to: "src/old/one.ts" },
    { from: "src/old/one.ts", to: "src/old/two.ts" },
    { from: "src/old/two.ts", to: "src/old/one.ts" },
    { from: "src/old/two.ts", to: limit.path },
  ];
  expect(ratchetFindings([limit], [], [imports[0]?.from ?? ""], imports)).toEqual([limit]);
});

test("reachability follows imports forward, not reverse dependents", () => {
  const limit = finding("checker-limit", "src/old/external.ts", "R1:package:old");
  const placed = "src/core/readings/value.ts";
  expect(ratchetFindings([limit], [], [placed], [{ from: limit.path, to: placed }])).toEqual([]);
});
