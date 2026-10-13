import { expect, test } from "vitest";
import { finding } from "../../src/core/readings/finding.js";

test("a finding carries rule, path and fix, and a debt key from rule, check, path and detail", () => {
  expect(finding("R2", "edge", "core/primitives/a", "Do x.", "core/primitives/b")).toEqual({
    rule: "R2",
    path: "core/primitives/a",
    fix: "Do x.",
    debtKey: "R2:edge:core/primitives/a:core/primitives/b",
  });
  expect(finding("R3", "no-heading", "core/primitives/a", "Do y.").debtKey).toBe(
    "R3:no-heading:core/primitives/a",
  );
});
