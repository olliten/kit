import { expect, test } from "vitest";
import { nameCheck } from "../../../src/core/reading/name-check.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

const keys = (parts: Parameters<typeof snapshotOf>[0]) =>
  nameCheck(snapshotOf({ terms: ["amount · retired: total", "sub"], ...parts })).map(
    (f) => f.debtKey,
  );

test("a retired word in a name is a finding, and its fix names the term that replaced it", () => {
  const [f, ...rest] = nameCheck(
    snapshotOf({ terms: ["amount · retired: total"], files: ["src/core/data/total.ts"] }),
  );
  expect(rest).toEqual([]);
  expect(f?.debtKey).toBe("R3:retired-word:core/data/total:total");
  expect(f?.fix).toContain("`amount`");
});

test("a retired word matches only a whole word: `subtotal` is not `total`", () => {
  expect(keys({ files: ["src/core/data/sub-total.ts", "src/core/data/subtotal.ts"] })).toEqual([
    "R3:retired-word:core/data/sub-total:total",
    "R3:undefined-word:core/data/subtotal:subtotal",
  ]);
});

test("a retired word in spec prose or an exported symbol is a finding; other prose words are free", () => {
  expect(
    keys({
      prose: ["Each subtotal is an amount; the Total is gone."],
      symbols: ["src/core/data/amount.ts#subTotal"],
    }),
  ).toEqual(["R3:retired-word:core/data/amount:total", "R3:retired-word:spec/topic.md:total"]);
});

test("a retired word in a placed file's comment is a finding; a legacy file's comment is not held", () => {
  expect(
    keys({
      comments: ["src/core/data/amount.ts#// Keeps the total small.", "src/main.ts#// total"],
    }),
  ).toEqual(["R3:retired-word:core/data/amount:total"]);
});
