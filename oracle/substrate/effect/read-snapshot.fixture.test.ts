import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { binder } from "../../../src/core/reading/binder.js";
import { dependencyCheck } from "../../../src/core/reading/dependency-check.js";
import { readSnapshot } from "../../../src/substrate/effect/read-snapshot.js";

const FIXTURE = fileURLToPath(new URL("../../../fixture", import.meta.url));

test("the fixture reads as its files, imports and headings", () => {
  const s = readSnapshot(FIXTURE);
  expect(s.files.filter((f) => f.type === "test").map((f) => f.path)).toEqual([
    "oracle/core/reading/total.sums.test.ts",
  ]);
  expect(s.headings).toHaveLength(7);
  expect(s.imports).toContainEqual({
    from: "src/shell/reading/screen.ts",
    to: "src/core/state/tally.ts",
  });
});

// The fixture seeds exactly three findings: a missing heading, a shell file importing core state, and
// an import cycle. Anything more or less is a regression in the reader or the readings.
test("the fixture yields exactly its seeded findings", () => {
  const s = readSnapshot(FIXTURE);
  expect([...binder(s), ...dependencyCheck(s)].map((f) => f.debtKey)).toEqual([
    "R3:no-heading:core/reading/label",
    "R2:cycle:core/reading/average:core/reading/average,core/reading/total",
    "R2:edge:shell/reading/screen:core/state/tally",
  ]);
});
