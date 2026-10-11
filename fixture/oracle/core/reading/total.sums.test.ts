// The law `sums` is a retired word, yet no finding: a law segment is the claim's anchor, not a name.
import { expect, test } from "vitest";
import { total } from "../../../src/core/reading/total.js";

test("total sums the amounts", () => {
  expect(total({ amounts: [1, 2, 3] })).toBe(6);
});
