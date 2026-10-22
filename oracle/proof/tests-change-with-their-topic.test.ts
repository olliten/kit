import { expect, test } from "vitest";
import type { ChangeHistory, ChangedFile } from "../../src/core/primitives/change-history.js";
import { testChangeCheck } from "../../src/core/readings/test-change-check.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const snapshot = snapshotOf({
  files: ["oracle/tally/total-sums.test.ts"],
  claims: [{ file: "spec/tally.md", anchor: "total-sums", line: 3 }],
});
const keys = (files: readonly ChangedFile[], messages: readonly string[] = []): string[] =>
  testChangeCheck(snapshot, { files, messages } satisfies ChangeHistory).map((row) => row.debtKey);
const edited: ChangedFile = { status: "modified", path: "oracle/tally/total-sums.test.ts" };

test("an edited claim test without its topic is a finding naming the fix", () => {
  const [row] = testChangeCheck(snapshot, { files: [edited], messages: [] });
  expect(row?.debtKey).toBe("R3:test-change:oracle/tally/total-sums.test.ts");
  expect(row?.fix).toContain("spec/tally.md");
  expect(row?.fix).toContain("Test fix: oracle/tally/total-sums.test.ts: <reason>");
});

test("a variant test is the claim's test too", () => {
  expect(keys([{ status: "modified", path: "oracle/tally/total-sums.empty.test.ts" }])).toEqual([
    "R3:test-change:oracle/tally/total-sums.empty.test.ts",
  ]);
});

test("the topic changing with the test answers it", () => {
  expect(keys([edited, { status: "modified", path: "spec/tally.md" }])).toEqual([]);
});

test("a commit line naming the test and a reason answers it", () => {
  expect(keys([edited], ["Tighten a fixture\n\nTest fix: oracle/tally/total-sums.test.ts: it read the wrong file"])).toEqual([]);
});

test.each([
  ["no reason", "Test fix: oracle/tally/total-sums.test.ts:"],
  ["another test", "Test fix: oracle/tally/other.test.ts: it was wrong"],
  ["not at a line's start", "See Test fix: oracle/tally/total-sums.test.ts: it was wrong"],
])("a commit line with %s does not", (_, message) => {
  expect(keys([edited], [message])).toHaveLength(1);
});

test.each([
  ["an added test", { status: "added", path: "oracle/tally/total-sums.more.test.ts" }],
  ["a deleted test", { status: "deleted", path: "oracle/tally/total-sums.test.ts" }],
  ["a shared proof module", { status: "modified", path: "oracle/core/readings/tally-cases.ts" }],
  ["a test of no declared topic", { status: "modified", path: "oracle/elsewhere/total-sums.test.ts" }],
  ["a file outside the proof root", { status: "modified", path: "src/core/readings/total.ts" }],
] as const)("%s is no finding", (_, file) => {
  expect(keys([file])).toEqual([]);
});
