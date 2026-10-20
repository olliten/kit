import { expect, test } from "vitest";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { termInventory } from "../../src/core/readings/term-inventory.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

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

test("definitions read from a terms file keep their lines, so the finding names both", () => {
  const terms = termInventory("# Terms\n\n- **step** — One move.\n- **Step** — Another move.\n").terms;
  const [finding, ...rest] = nameCheck({ ...snapshotOf({}), terms });
  expect(rest).toEqual([]);
  expect(finding?.debtKey).toBe("R3:duplicate-term:step");
  expect(finding?.fix).toContain("lines 3, 4");
});
