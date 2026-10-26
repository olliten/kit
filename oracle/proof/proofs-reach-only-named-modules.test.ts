import { expect, test } from "vitest";
import { proofScope } from "../../src/core/readings/proof-scope.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const claim = (terms: string[]) => ({ file: "spec/topic.md", anchor: "total-sums", line: 1, terms });
const keys = (parts: Parameters<typeof snapshotOf>[0]) =>
  proofScope(snapshotOf(parts)).map((finding) => finding.debtKey);
const test_ = "oracle/topic/total-sums.test.ts";

test("a test reaching only the named module is exact", () => {
  expect(
    keys({
      files: ["src/core/readings/total.ts", test_],
      imports: [`${test_} > src/core/readings/total.ts`],
      claims: [claim(["total"])],
    }),
  ).toEqual([]);
});

test("a module the test reaches without the claim naming it is debt", () => {
  const result = proofScope(
    snapshotOf({
      files: ["src/core/readings/total.ts", "src/core/readings/round.ts", test_],
      imports: [`${test_} > src/core/readings/total.ts`, "src/core/readings/total.ts > src/core/readings/round.ts"],
      claims: [claim(["total"])],
    }),
  );
  expect(result.map((finding) => [finding.debtKey, finding.category])).toEqual([
    ["R4:proof-scope:spec/topic.md:total-sums:src/core/readings/round.ts", "legacy-debt"],
  ]);
});

test("what an oracle helper reaches counts as the test's, but the helper needs no name", () => {
  expect(
    keys({
      files: ["src/core/readings/total.ts", "src/core/readings/round.ts", "oracle/core/readings/cases.ts", test_],
      imports: [
        `${test_} > oracle/core/readings/cases.ts`,
        "oracle/core/readings/cases.ts > src/core/readings/total.ts",
        "oracle/core/readings/cases.ts > src/core/readings/round.ts",
      ],
      claims: [claim(["total"])],
    }),
  ).toEqual(["R4:proof-scope:spec/topic.md:total-sums:src/core/readings/round.ts"]);
});

test("naming a composition names what it composes", () => {
  expect(
    keys({
      files: ["src/core/compositions/run.ts", "src/core/readings/total.ts", "src/core/readings/round.ts", test_],
      imports: [
        `${test_} > src/core/compositions/run.ts`,
        "src/core/compositions/run.ts > src/core/readings/total.ts",
        "src/core/readings/total.ts > src/core/readings/round.ts",
      ],
      claims: [claim(["run"])],
    }),
  ).toEqual([]);
});

test("unplaced code needs no name", () => {
  expect(
    keys({
      files: ["src/core/readings/total.ts", "lib/old.ts", test_],
      imports: [`${test_} > src/core/readings/total.ts`, "src/core/readings/total.ts > lib/old.ts"],
      claims: [claim(["total"])],
    }),
  ).toEqual([]);
});

test("naming an oracle helper covers only the helper, not what it composes", () => {
  expect(
    keys({
      files: ["oracle/substrate/compositions/fixture.ts", "src/core/readings/total.ts", test_],
      imports: [`${test_} > oracle/substrate/compositions/fixture.ts`, "oracle/substrate/compositions/fixture.ts > src/core/readings/total.ts"],
      claims: [claim(["fixture"])],
    }),
  ).toEqual(["R4:proof-scope:spec/topic.md:total-sums:src/core/readings/total.ts"]);
});
