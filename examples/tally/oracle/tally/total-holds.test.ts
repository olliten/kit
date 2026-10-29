import { expect, test } from "vitest";
import { EMPTY_TALLY } from "../../src/core/primitives/tally.js";
import { total } from "../../src/core/readings/total.js";

test("the total sums the amounts", () => {
  expect(total({ amounts: [1, 2, 3] })).toBe(6);
  expect(total(EMPTY_TALLY)).toBe(0);
});
