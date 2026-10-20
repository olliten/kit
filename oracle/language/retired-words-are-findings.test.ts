import { expect, test } from "vitest";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const keys = (parts: Parameters<typeof snapshotOf>[0]) =>
  nameCheck(snapshotOf({ terms: ["amount · retired: total", "sub"], ...parts })).map(
    (f) => f.debtKey,
  );

test("a retired word in a name is a finding, and its fix names the term that replaced it", () => {
  const [f, ...rest] = nameCheck(
    snapshotOf({ terms: ["amount · retired: total"], files: ["src/core/primitives/total.ts"] }),
  );
  expect(rest).toEqual([]);
  expect(f?.debtKey).toBe("R3:retired-word:core/primitives/total:total");
  expect(f?.fix).toContain("`amount`");
});

test("a retired word matches only a whole word: `subtotal` is not `total`", () => {
  expect(
    keys({ files: ["src/core/primitives/sub-total.ts", "src/core/primitives/subtotal.ts"] }),
  ).toEqual(["R3:retired-word:core/primitives/sub-total:total"]);
});

test("a retired word in spec prose or an exported symbol is a finding; other prose words are free", () => {
  expect(
    keys({
      prose: ["Each subtotal is an amount; the Total is gone."],
      symbols: ["src/core/primitives/amount.ts#subTotal"],
    }),
  ).toEqual([
    "R3:retired-word:core/primitives/amount:total",
    "R3:retired-word:spec/topic.md:total",
  ]);
});

test("claim-first proof names still reject explicitly retired words without term fragments", () => {
  expect(keys({ terms: ["amount"], files: ["oracle/topic/total-sums.test.ts"] })).toEqual([]);
  expect(
    keys({ terms: ["amount · retired: sums"], files: ["oracle/topic/total-sums.test.ts"] }),
  ).toEqual(["R3:retired-word:oracle/topic/total-sums.test.ts:sums"]);
});

test("a retired word in a placed file's comment is a finding; a legacy file's comment is not held", () => {
  expect(
    keys({
      comments: ["src/core/primitives/amount.ts#// Keeps the total small.", "src/main.ts#// total"],
    }),
  ).toEqual(["R3:retired-word:core/primitives/amount:total"]);
});
