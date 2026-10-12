import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { binder } from "../../src/core/readings/binder.js";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { readSnapshot } from "../../src/substrate/primitives/read-snapshot.js";

const FIXTURE = fileURLToPath(new URL("../../fixture", import.meta.url));

test("the fixture reads as its files, imports and headings", () => {
  const s = readSnapshot(FIXTURE);
  expect(s.files.filter((f) => f.type === "test").map((f) => f.path)).toEqual([
    "oracle/tally/total-holds.test.ts",
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
  expect(s.symbols).toContainEqual({ file: "src/core/primitives/limits.ts", name: "MAX_STEP" });
  expect(s.imports).toContainEqual({
    from: "src/shell/readings/screen.ts",
    to: "src/substrate/compositions/save.ts",
  });
  // Comments, not strings: a `//` inside a URL is not one.
  expect(s.comments).toContainEqual({
    file: "src/core/primitives/limits.ts",
    line: 1,
    text: "// Seeded: a citation of {#one-step-is-capped}.",
  });
});

// The fixture seeds exactly seven findings: a missing heading, a shell file importing substrate code, an
// import cycle, a retired word in spec prose, an exported symbol with an undefined word, a comment
// citation and a comment debt marker. Anything more or less is a regression in the reader or the readings.
test("the fixture yields exactly its seeded findings", () => {
  const s = readSnapshot(FIXTURE);
  const all = [...binder(s), ...dependencyCheck(s), ...nameCheck(s), ...commentCheck(s)];
  expect(all.map((f) => f.debtKey)).toEqual([
    "R3:no-heading:core/readings/label",
    "R2:cycle:core/readings/average:core/readings/average,core/readings/total",
    "R2:edge:shell/readings/screen:substrate/compositions/save",
    "R3:retired-word:spec/tally.md:sums",
    "R3:undefined-word:core/readings/total:summary",
    "R3:comment-citation:core/primitives/limits:{#one-step-is-capped}",
    "R3:comment-debt:core/compositions/add:TODO",
  ]);
});
