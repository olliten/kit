// The proof names its topic claim independently of the module identity.
import { expect, test } from "vitest";
import { total } from "../../src/core/readings/total.js";

test("total sums the amounts", () => {
  expect(total({ amounts: [1, 2, 3] })).toBe(6);
});
