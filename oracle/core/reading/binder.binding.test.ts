import { describe, expect, test } from "vitest";
import { binder } from "../../../src/core/reading/binder.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

const keys = (s: Parameters<typeof binder>[0]) => binder(s).map((f) => f.debtKey);

describe("binder: one path in spec, code and oracle", () => {
  test("a bound artifact with a well-named test has no finding", () => {
    const s = snapshotOf({
      files: ["src/core/reading/total.ts", "oracle/core/reading/total.sums.test.ts"],
      headings: ["core/reading/total"],
    });
    expect(binder(s)).toEqual([]);
  });

  test("a heading with no file", () => {
    expect(keys(snapshotOf({ headings: ["core/change/add"] }))).toEqual([
      "R3:no-file:core/change/add",
    ]);
  });

  test("a file with no heading, and its fix names the heading to add", () => {
    const [f, ...rest] = binder(snapshotOf({ files: ["src/shell/effect/paint.ts"] }));
    expect(rest).toEqual([]);
    expect(f?.debtKey).toBe("R3:no-heading:shell/effect/paint");
    expect(f?.fix).toContain("### shell/effect/paint");
  });

  test("a heading in two places", () => {
    const s = snapshotOf({
      files: ["src/core/data/x.ts"],
      headings: ["core/data/x", "core/data/x"],
    });
    expect(keys(s)).toEqual(["R3:duplicate-heading:core/data/x"]);
  });

  test("a test whose prefix names no artifact, and a test with no law segment", () => {
    const s = snapshotOf({
      files: ["oracle/core/reading/gone.sums.test.ts", "oracle/core/reading/total.test.ts"],
    });
    expect(keys(s)).toEqual([
      "R3:orphan-test:oracle/core/reading/gone.sums.test.ts",
      "R3:test-name:oracle/core/reading/total.test.ts",
    ]);
  });

  test("legacy files and tests outside the layout are not held", () => {
    const s = snapshotOf({ files: ["src/main.ts", "oracle/lib/world.test.ts"] });
    expect(binder(s)).toEqual([]);
  });
});
