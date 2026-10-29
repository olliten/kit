import { expect, test } from "vitest";
import { claimInventory } from "../../src/core/readings/claim-inventory.js";
import { topicShape } from "../../src/core/readings/topic-shape.js";
import { bindingFindings } from "../core/readings/binding-findings.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

test.each([false, true])("annotations keep list relationships and proof binding, roles last=%s", (last) => {
  const text = "# Tally\n\n" + (last
    ? "| Promise | Implementation | Proof |\n| --- | --- | --- |\n" +
      "| A total is exact. | {{total}}, {{surface}} | {{cases}} · {#exact} |\n"
    : "| Proof | Implementation | Promise |\n| --- | --- | --- |\n" +
      "| {{cases}} | {{total}}, {{surface}} | A total is exact. · {#exact} |\n");
  const list = "- A total is exact. · {#exact}\n  - Implementation: {{total}}, {{surface}}\n  - Proof: {{cases}}\n";
  expect(topicShape(snapshotOf({ prose: [text] }))).toEqual([]);
  const row = claimInventory(text).declarations[0];
  const old = claimInventory(list).declarations[0];
  expect(row).toMatchObject({ anchor: "exact", implementation: ["total", "surface"], proof: ["cases"] });
  if (row === undefined) throw new Error("the table declares no claim");
  expect([...(row.terms ?? [])].sort()).toEqual([...(old?.terms ?? [])].sort());
  const snapshot = snapshotOf({ files: ["oracle/tally/exact.test.ts"] });
  expect(bindingFindings({ ...snapshot, claims: [{ ...row, file: "spec/tally.md" }] })).toEqual([]);
});

test("empty annotation cells omit relationships, including an anchor-only final cell", () => {
  const text = "# Tally\n\n| Promise | Implementation | Proof |\n| --- | --- | --- |\n" +
    "| Exact. {{total}} | | · {#exact} |\n";
  expect(topicShape(snapshotOf({ prose: [text] }))).toEqual([]);
  expect(claimInventory(text).declarations).toEqual([
    { anchor: "exact", line: 5, terms: ["total"] },
  ]);
});

test.each([
  "{{total}}, {{Total}}", "{{total}},", "{{ }}", "{{total}} and behavior",
  "`{{total}}`", "**{{total}}**", "\\{{total}}", "&#123;&#123;total&#125;&#125;",
])("malformed annotation is a finding: %s", (value) => {
  const text = "# Tally\n\n| Implementation | Promise |\n| --- | --- |\n" +
    `| ${value} | Exact. {#exact} |\n`;
  expect(topicShape(snapshotOf({ prose: [text] })).length).toBe(1);
});

test.each(["Implementation", "Proof"])("duplicate %s columns are a finding", (role) => {
  const text = `# Tally\n\n| ${role} | ${role} | Promise |\n| --- | --- | --- |\n` +
    "| | | Exact. {#exact} |\n";
  expect(topicShape(snapshotOf({ prose: [text] })).length).toBeGreaterThan(0);
});

test("a configured claim separator is not part of a final annotation value", () => {
  const text = "# Tally\n\n| Promise | Proof |\n| --- | --- |\n| Exact. | {{cases}} ~ {#exact} |\n";
  const snapshot = snapshotOf({ prose: [text] });
  expect(topicShape({ ...snapshot, config: { ...snapshot.config, claimSeparator: "~" } })).toEqual([]);
  expect(claimInventory(text, { separator: "~" }).declarations).toEqual([
    { anchor: "exact", line: 5, terms: ["cases"], proof: ["cases"] },
  ]);
});
