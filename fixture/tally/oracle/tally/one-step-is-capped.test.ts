import { expect, test } from "vitest";
import { add } from "../../src/core/compositions/add.js";
import { MAX_STEP } from "../../src/core/primitives/limits.js";

test("one step adds at most the limit", () => {
  expect(add({ amounts: [] }, MAX_STEP + 5).amounts).toEqual([MAX_STEP]);
  expect(add({ amounts: [1] }, 2).amounts).toEqual([1, 2]);
});
