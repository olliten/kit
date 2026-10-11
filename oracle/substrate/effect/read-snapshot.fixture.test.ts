import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { binder } from "../../../src/core/reading/binder.js";
import { commentCheck } from "../../../src/core/reading/comment-check.js";
import { dependencyCheck } from "../../../src/core/reading/dependency-check.js";
import { nameCheck } from "../../../src/core/reading/name-check.js";
import { readSnapshot } from "../../../src/substrate/effect/read-snapshot.js";

const FIXTURE = fileURLToPath(new URL("../../../fixture", import.meta.url));

test("the fixture reads as its files, imports and headings", () => {
  const s = readSnapshot(FIXTURE);
  expect(s.files.filter((f) => f.type === "test").map((f) => f.path)).toEqual([
    "oracle/core/reading/total.sums.test.ts",
  ]);
  expect(s.headings).toHaveLength(7);
  // The terms file's section headings are not module headings, and its prose omits its term lines.
  expect(s.terms).toHaveLength(12);
  expect(s.terms).toContainEqual({
    term: "total",
    meaning: "the sum of the amounts.",
    retired: ["sums"],
    line: 14,
  });
  expect(s.prose.find((p) => p.file === "spec/terms.md")?.text).not.toContain("**");
  expect(s.symbols).toContainEqual({ file: "src/core/data/limits.ts", name: "MAX_STEP" });
  expect(s.imports).toContainEqual({
    from: "src/shell/reading/screen.ts",
    to: "src/core/state/tally.ts",
  });
  // Comments, not strings: a `//` inside a URL is not one.
  expect(s.comments).toContainEqual({
    file: "src/core/data/limits.ts",
    line: 1,
    text: "// Seeded: a citation of {#one-step-is-capped}.",
  });
});

// The fixture seeds exactly seven findings: a missing heading, a shell file importing core state, an
// import cycle, a retired word in spec prose, an exported symbol with an undefined word, a comment
// citation and a comment debt marker. Anything more or less is a regression in the reader or the readings.
test("the fixture yields exactly its seeded findings", () => {
  const s = readSnapshot(FIXTURE);
  const all = [...binder(s), ...dependencyCheck(s), ...nameCheck(s), ...commentCheck(s)];
  expect(all.map((f) => f.debtKey)).toEqual([
    "R3:no-heading:core/reading/label",
    "R2:cycle:core/reading/average:core/reading/average,core/reading/total",
    "R2:edge:shell/reading/screen:core/state/tally",
    "R3:retired-word:spec/tally.md:sums",
    "R3:undefined-word:core/reading/total:summary",
    "R3:comment-citation:core/data/limits:{#one-step-is-capped}",
    "R3:comment-debt:core/change/add:TODO",
  ]);
});
