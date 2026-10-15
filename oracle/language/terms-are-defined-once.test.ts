import { expect, test } from "vitest";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { snapshotOf } from "../lib/snapshotOf.js";

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

test("case and repeated spaces do not create another global definition identity", () => {
  const [finding, ...rest] = nameCheck(snapshotOf({ terms: ["Not before", "NOT   BEFORE"] }));
  expect(rest).toEqual([]);
  expect(finding?.debtKey).toBe("R3:duplicate-term:not before");
  expect(finding?.fix).toContain("lines 1, 2");
});

test("punctuation distinguishes global definition identities", () => {
  expect(nameCheck(snapshotOf({ terms: ["Not before", "not-before"] }))).toEqual([]);
});
