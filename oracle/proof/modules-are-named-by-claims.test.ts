import { describe, expect, test } from "vitest";
import { claimsKeptBy } from "../../src/core/readings/module-references.js";
import { bindingFindings } from "../lib/bindingFindings.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const keys = (s: Parameters<typeof bindingFindings>[0]) => bindingFindings(s).map((f) => f.debtKey);

describe("a placed module is named by the claims it keeps", () => {
  test("a module named by a proved claim has no finding", () => {
    const s = snapshotOf({
      files: ["src/core/readings/total.ts", "oracle/topic/total-sums.test.ts"],
      claims: [{ file: "spec/topic.md", anchor: "total-sums", line: 1, terms: ["total"] }],
    });
    expect(bindingFindings(s)).toEqual([]);
  });

  test("a module no claim names is a finding", () => {
    expect(keys(snapshotOf({ files: ["src/shell/compositions/paint.ts"] }))).toEqual([
      "R4:unreferenced-module:shell/compositions/paint",
    ]);
  });

  test("a module may be named by claims in several topics, and keeps each of them", () => {
    const s = snapshotOf({
      files: ["src/core/primitives/x.ts", "oracle/one/x-holds.test.ts", "oracle/two/x-stays.test.ts"],
      claims: [
        { file: "spec/one.md", anchor: "x-holds", line: 1, terms: ["x"] },
        { file: "spec/two.md", anchor: "x-stays", line: 1, terms: ["X"] },
      ],
    });
    expect(keys(s)).toEqual([]);
    expect(claimsKeptBy(s).get("x")).toEqual([
      { file: "spec/one.md", anchor: "x-holds" },
      { file: "spec/two.md", anchor: "x-stays" },
    ]);
  });

  test("obsolete module-based proof names are rejected even when the module exists", () => {
    const s = snapshotOf({
      files: [
        "src/core/readings/total.ts",
        "oracle/core/readings/gone.sums.test.ts",
        "oracle/core/readings/total.test.ts",
      ],
      claims: [{ file: "spec/topic.md", anchor: "total-sums", line: 1, terms: ["total"] }],
    });
    expect(keys(s)).toEqual([
      "R3:missing-proof:spec/topic.md:total-sums",
      "R3:test-name:oracle/core/readings/gone.sums.test.ts",
      "R3:test-name:oracle/core/readings/total.test.ts",
    ]);
  });

  test("a module named in the plural is named by its singular term", () => {
    const named = (terms: string[]) =>
      keys(
        snapshotOf({
          files: ["src/core/primitives/steps.ts", "oracle/topic/steps-hold.test.ts"],
          claims: [{ file: "spec/topic.md", anchor: "steps-hold", line: 1, terms }],
        }),
      );
    expect(named(["step"])).toEqual([]);
    expect(named(["stepping"])).toEqual(["R4:unreferenced-module:core/primitives/steps"]);
  });

  test("legacy source files are not checked", () => {
    const s = snapshotOf({ files: ["src/main.ts", "src/core/state/x.ts"] });
    expect(bindingFindings(s)).toEqual([]);
  });
});
