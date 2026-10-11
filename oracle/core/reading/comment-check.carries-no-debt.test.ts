import { expect, test } from "vitest";
import { commentCheck } from "../../../src/core/reading/comment-check.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

test("a debt marker in a comment is a finding whose fix moves it to a debt list", () => {
  const [f, ...rest] = commentCheck(
    snapshotOf({ comments: ["src/core/change/add.ts#// TODO: clamp negative amounts."] }),
  );
  expect(rest).toEqual([]);
  expect(f?.debtKey).toBe("R3:comment-debt:core/change/add:TODO");
  expect(f?.fix).toContain("debt list");
});

test("a marker counts only as a whole word in capitals", () => {
  expect(
    commentCheck(
      snapshotOf({
        comments: ["src/core/change/add.ts#// todos and TODOS are words here; HACKY too."],
      }),
    ),
  ).toEqual([]);
});
