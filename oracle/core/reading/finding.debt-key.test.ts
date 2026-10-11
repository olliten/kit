import { expect, test } from "vitest";
import { finding } from "../../../src/core/reading/finding.js";

test("a finding carries rule, path and fix, and a debt key from rule, check, path and detail", () => {
  expect(finding("R2", "edge", "core/data/a", "Do x.", "core/state/b")).toEqual({
    rule: "R2",
    path: "core/data/a",
    fix: "Do x.",
    debtKey: "R2:edge:core/data/a:core/state/b",
  });
  expect(finding("R3", "no-heading", "core/data/a", "Do y.").debtKey).toBe(
    "R3:no-heading:core/data/a",
  );
});
