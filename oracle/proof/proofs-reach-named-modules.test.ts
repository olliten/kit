import { expect, test } from "vitest";
import { proofReach } from "../../src/core/readings/proof-reach.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const claim = (terms: string[], anchor = "total-sums") => ({
  file: "spec/topic.md",
  anchor,
  line: 1,
  terms,
});
const keys = (parts: Parameters<typeof snapshotOf>[0]) =>
  proofReach(snapshotOf(parts)).map((finding) => finding.debtKey);

test("a test that imports the named module reaches it", () => {
  expect(
    keys({
      files: ["src/core/readings/total.ts", "oracle/topic/total-sums.test.ts"],
      imports: ["oracle/topic/total-sums.test.ts > src/core/readings/total.ts"],
      claims: [claim(["total"])],
    }),
  ).toEqual([]);
});

test("a named module reached through a helper and another module is reached", () => {
  expect(
    keys({
      files: [
        "src/core/primitives/step.ts",
        "src/core/readings/total.ts",
        "oracle/lib/fixture.ts",
        "oracle/topic/total-sums.test.ts",
      ],
      imports: [
        "oracle/topic/total-sums.test.ts > oracle/lib/fixture.ts",
        "oracle/lib/fixture.ts > src/core/readings/total.ts",
        "src/core/readings/total.ts > src/core/primitives/step.ts",
      ],
      claims: [claim(["total", "step"])],
    }),
  ).toEqual([]);
});

test("a named module no test of the claim reaches is a finding", () => {
  const findings = proofReach(
    snapshotOf({
      files: ["src/core/readings/total.ts", "src/core/readings/average.ts", "oracle/topic/total-sums.test.ts"],
      imports: ["oracle/topic/total-sums.test.ts > src/core/readings/average.ts"],
      claims: [claim(["total", "average"])],
    }),
  );
  expect(findings.map((finding) => finding.debtKey)).toEqual([
    "R4:unreached-module:spec/topic.md:total-sums:total",
  ]);
  expect(findings[0]?.fix).toContain("{{total}}");
});

test("variants reach the named modules together", () => {
  expect(
    keys({
      files: [
        "src/core/readings/total.ts",
        "src/core/readings/average.ts",
        "oracle/topic/total-sums.test.ts",
        "oracle/topic/total-sums.average.test.ts",
      ],
      imports: [
        "oracle/topic/total-sums.test.ts > src/core/readings/total.ts",
        "oracle/topic/total-sums.average.test.ts > src/core/readings/average.ts",
      ],
      claims: [claim(["total", "average"])],
    }),
  ).toEqual([]);
});

test("a test of another claim does not reach for this one", () => {
  expect(
    keys({
      files: [
        "src/core/readings/total.ts",
        "oracle/topic/total-sums.test.ts",
        "oracle/topic/total-stays.test.ts",
      ],
      imports: ["oracle/topic/total-stays.test.ts > src/core/readings/total.ts"],
      claims: [claim(["total"]), claim(["total"], "total-stays")],
    }),
  ).toEqual(["R4:unreached-module:spec/topic.md:total-sums:total"]);
});

test("a module named in the plural is reached through its singular term", () => {
  expect(
    keys({
      files: ["src/core/primitives/steps.ts", "oracle/topic/total-sums.test.ts"],
      imports: ["oracle/topic/total-sums.test.ts > src/core/primitives/steps.ts"],
      claims: [claim(["step"])],
    }),
  ).toEqual([]);
});

test("a claim without tests, and a name that is no placed module, leave reach to other checks", () => {
  expect(
    keys({
      files: ["src/core/readings/total.ts", "oracle/topic/total-stays.test.ts"],
      claims: [claim(["total"]), claim(["capability"], "total-stays")],
    }),
  ).toEqual([]);
});
