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

// Placed oracle modules need the oracle root among the code roots, as an app that places its harness declares.
const rooted = (parts: Parameters<typeof snapshotOf>[0], srcRoot: string[], oracleRoot = "oracle") => {
  const snapshot = snapshotOf(parts);
  return proofScope({ ...snapshot, config: { ...snapshot.config, srcRoot, oracleRoot } }).map((finding) => finding.debtKey);
};

test("naming a placed module under the proof root names what it reaches, whatever its layer", () => {
  for (const helper of [
    "oracle/substrate/compositions/fixture.ts",
    "oracle/substrate/adapters/fixture.ts",
    "oracle/core/readings/fixture.ts",
  ])
    expect(
      rooted(
        {
          files: [helper, "src/core/readings/total.ts", "src/core/readings/round.ts", test_],
          imports: [`${test_} > ${helper}`, `${helper} > src/core/readings/total.ts`, "src/core/readings/total.ts > src/core/readings/round.ts"],
          claims: [claim(["fixture"])],
        },
        ["oracle", "src"],
      ),
    ).toEqual([]);
});

test("a named reading under another code root still names only itself", () => {
  expect(
    rooted(
      {
        files: ["lib/core/readings/fixture.ts", "src/core/readings/total.ts", test_],
        imports: [`${test_} > lib/core/readings/fixture.ts`, "lib/core/readings/fixture.ts > src/core/readings/total.ts"],
        claims: [claim(["fixture"])],
      },
      ["lib", "src"],
    ),
  ).toEqual(["R4:proof-scope:spec/topic.md:total-sums:src/core/readings/total.ts"]);
});

test("the proof root is the configured one, not whichever code root holds the module", () => {
  const test = "proofs/topic/total-sums.test.ts";
  const parts = {
    files: ["proofs/core/readings/fixture.ts", "src/core/readings/total.ts", test],
    imports: [`${test} > proofs/core/readings/fixture.ts`, "proofs/core/readings/fixture.ts > src/core/readings/total.ts"],
    claims: [claim(["fixture"])],
  };
  expect(rooted(parts, ["proofs", "src"], "proofs")).toEqual([]);
});
