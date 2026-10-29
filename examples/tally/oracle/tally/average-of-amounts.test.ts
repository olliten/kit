import { expect, test } from "vitest";
import { average } from "../../src/core/readings/average.js";

test("the average is the total over the count of amounts", () => {
  expect(average({ amounts: [2, 4] })).toBe(3);
  expect(average({ amounts: [] })).toBe(0);
});
