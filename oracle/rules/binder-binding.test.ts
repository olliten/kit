import { describe, expect, test } from "vitest";
import { binder } from "../../src/core/readings/binder.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const keys = (s: Parameters<typeof binder>[0]) => binder(s).map((f) => f.debtKey);

describe("binder: module identities bind source while claim anchors bind proofs", () => {
  test("a bound module and a claim-first proof have no finding", () => {
    const s = snapshotOf({
      files: ["src/core/readings/total.ts", "oracle/topic/total-sums.test.ts"],
      headings: ["core/readings/total"],
      claims: [{ file: "spec/topic.md", anchor: "total-sums", line: 1 }],
    });
    expect(binder(s)).toEqual([]);
  });

  test("a heading with no file", () => {
    expect(keys(snapshotOf({ headings: ["core/compositions/add"] }))).toEqual([
      "R3:no-file:core/compositions/add",
    ]);
  });

  test("a file with no heading, and its fix names the heading to add", () => {
    const [f, ...rest] = binder(snapshotOf({ files: ["src/shell/compositions/paint.ts"] }));
    expect(rest).toEqual([]);
    expect(f?.debtKey).toBe("R3:no-heading:shell/compositions/paint");
    expect(f?.fix).toContain("### shell/compositions/paint");
  });

  test("a heading in two places", () => {
    const s = snapshotOf({
      files: ["src/core/primitives/x.ts"],
      headings: ["core/primitives/x", "core/primitives/x"],
    });
    expect(keys(s)).toEqual(["R3:duplicate-heading:core/primitives/x"]);
  });

  test("obsolete module-based proof names are rejected even when the module exists", () => {
    const s = snapshotOf({
      files: [
        "src/core/readings/total.ts",
        "oracle/core/readings/gone.sums.test.ts",
        "oracle/core/readings/total.test.ts",
      ],
      headings: ["core/readings/total"],
    });
    expect(keys(s)).toEqual([
      "R3:test-name:oracle/core/readings/gone.sums.test.ts",
      "R3:test-name:oracle/core/readings/total.test.ts",
    ]);
  });

  test("legacy source files are not module-bound", () => {
    const s = snapshotOf({ files: ["src/main.ts", "src/core/state/x.ts"] });
    expect(binder(s)).toEqual([]);
  });
});
