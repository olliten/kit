import { expect, test } from "vitest";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { snapshotOf } from "../lib/snapshotOf.js";

test("a debt marker in a comment is a finding whose fix moves it to a debt list", () => {
  const [f, ...rest] = commentCheck(
    snapshotOf({ comments: ["src/core/compositions/add.ts#// TODO: clamp negative amounts."] }),
  );
  expect(rest).toEqual([]);
  expect(f?.debtKey).toBe("R3:comment-debt:core/compositions/add:TODO");
  expect(f?.fix).toContain("debt list");
});

test("a marker counts only as a whole word in capitals", () => {
  expect(
    commentCheck(
      snapshotOf({
        comments: ["src/core/compositions/add.ts#// todos and TODOS are words here; HACKY too."],
      }),
    ),
  ).toEqual([]);
});
