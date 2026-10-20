import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { bindingFindings } from "../core/readings/binding-findings.js";

const FIXTURE = fileURLToPath(new URL("../../fixture", import.meta.url));

test("the fixture reads as its files, imports, claims and terms", () => {
  const s = readSnapshot(FIXTURE);
  expect(s.files.filter((f) => f.type === "test").map((f) => f.path)).toEqual([
    "oracle/tally/average-of-amounts.test.ts",
    "oracle/tally/one-step-is-capped.test.ts",
    "oracle/tally/screen-shows-the-total.test.ts",
    "oracle/tally/total-holds.test.ts",
  ]);
  // Each claim records the modules it names.
  expect(s.claims?.map((claim) => [claim.anchor, claim.terms])).toEqual([
    ["total-holds", ["tally", "total"]],
    ["one-step-is-capped", ["add", "limits"]],
    ["average-of-amounts", ["average"]],
    ["screen-shows-the-total", ["screen", "label"]],
  ]);
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

// The fixture retains direction, cycle, retirement, citation, debt and unnamed-module findings.
// Its summary export remains valid under the ratified supporting-symbol rule.
test("the fixture yields exactly its seeded findings", () => {
  const s = readSnapshot(FIXTURE);
  const all = [...bindingFindings(s), ...dependencyCheck(s), ...nameCheck(s), ...commentCheck(s)];
  expect(all.map((f) => f.debtKey)).toEqual([
    "R4:unreferenced-module:substrate/compositions/save",
    "R2:cycle:core/readings/average:core/readings/average,core/readings/total",
    "R2:edge:shell/readings/screen:substrate/compositions/save",
    "R3:retired-word:spec/tally.md:sums",
    "R3:comment-citation:core/primitives/limits:{#one-step-is-capped}",
    "R3:comment-debt:core/compositions/add:TODO",
  ]);
});
