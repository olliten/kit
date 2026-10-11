import { expect, test } from "vitest";
import { commentCheck } from "../../../src/core/reading/comment-check.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

const keys = (...comments: string[]) =>
  commentCheck(snapshotOf({ comments })).map((f) => f.debtKey);

test("a comment that says why the code is built this way is free", () => {
  expect(
    keys("src/core/reading/total.ts#// One pass: the amounts list can hold a year of steps."),
  ).toEqual([]);
});

test("a claim anchor, a Markdown file and a module identity are citations", () => {
  expect(
    keys(
      "src/core/reading/total.ts#// Sums the amounts {#total-sums} as spec/tally.md says.",
      "src/core/change/add.ts#/* Reads core/data/limits before it adds. */",
    ),
  ).toEqual([
    "R3:comment-citation:core/change/add:core/data/limits",
    "R3:comment-citation:core/reading/total:spec/tally.md",
    "R3:comment-citation:core/reading/total:{#total-sums}",
  ]);
});

test("the citation's fix says what to delete, and a pattern with placeholders is not a citation", () => {
  const [f] = commentCheck(
    snapshotOf({ comments: ["src/core/data/limits.ts#// see {#max-step}"] }),
  );
  expect(f?.fix).toContain("delete the citation `{#max-step}`");
  expect(keys("src/core/reading/kind-of.ts#// Reads <zone>/<kind>/<name> from a path.")).toEqual(
    [],
  );
});

test("a test's comments are held under the test's path; legacy files are not held", () => {
  expect(
    keys(
      "oracle/core/reading/total.sums.test.ts#// Pins {#total-sums}.",
      "src/main.ts#// Legacy may still cite {#total-sums} until it moves.",
    ),
  ).toEqual(["R3:comment-citation:oracle/core/reading/total.sums.test.ts:{#total-sums}"]);
});
