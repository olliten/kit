import { expect, test } from "vitest";
import { nameCheck } from "../../../src/core/reading/name-check.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

test("a term defined once has no finding", () => {
  expect(nameCheck(snapshotOf({ terms: ["step", "running-total"] }))).toEqual([]);
});

test("a term defined twice is one finding, and its fix names both lines", () => {
  const [f, ...rest] = nameCheck(
    snapshotOf({ terms: ["step", "limit", "step · retired: stride"] }),
  );
  expect(rest).toEqual([]);
  expect(f?.debtKey).toBe("R3:duplicate-term:step");
  expect(f?.fix).toContain("lines 1, 3");
});
