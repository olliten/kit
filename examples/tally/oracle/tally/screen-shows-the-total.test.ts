import { expect, test } from "vitest";
import { screen } from "../../src/shell/readings/screen.js";

test("the screen shows the total as text", () => {
  expect(screen({ amounts: [1, 2] })).toBe("Total: 3");
});
