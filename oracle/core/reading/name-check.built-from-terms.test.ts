import { describe, expect, test } from "vitest";
import { nameCheck } from "../../../src/core/reading/name-check.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

const keys = (parts: Parameters<typeof snapshotOf>[0]) =>
  nameCheck(snapshotOf({ terms: ["step", "limit", "amount", "running-total"], ...parts })).map(
    (f) => f.debtKey,
  );

describe("nameCheck: module names and exported symbols use only terms and connectors", () => {
  test("a name of terms has no finding", () => {
    expect(
      keys({
        files: ["src/core/reading/step-limit.ts", "oracle/core/reading/step-limit.amount.test.ts"],
      }),
    ).toEqual([]);
  });

  test("an undefined word is a finding, and its fix names the term to define", () => {
    const [f, ...rest] = nameCheck(snapshotOf({ files: ["src/core/reading/cap.ts"] }));
    expect(rest).toEqual([]);
    expect(f?.debtKey).toBe("R3:undefined-word:core/reading/cap:cap");
    expect(f?.fix).toContain("- **cap** —");
  });

  test("a compound term matches before its parts, in kebab, camelCase and snake alike", () => {
    const at = "src/core/change/running-total.ts";
    expect(keys({ files: [at], symbols: [`${at}#runningTotal`, `${at}#RUNNING_TOTAL`] })).toEqual(
      [],
    );
    expect(keys({ files: ["src/core/change/total-running.ts"] })).toEqual([
      "R3:undefined-word:core/change/total-running:running",
      "R3:undefined-word:core/change/total-running:total",
    ]);
  });

  test("connectors need no term", () => {
    expect(keys({ files: ["src/core/reading/limit-of-the-step.ts"] })).toEqual([]);
  });

  test("zone and kind segments are structure, never checked; legacy files are not held", () => {
    expect(
      keys({ files: ["src/shell/effect/step.ts", "src/main.ts", "src/util/stuff.ts"] }),
    ).toEqual([]);
  });

  test("camelCase symbols split on case boundaries", () => {
    const at = "src/core/reading/step.ts";
    expect(keys({ symbols: [`${at}#stepLimit`, `${at}#AmountStep`, `${at}#stepCap`] })).toEqual([
      "R3:undefined-word:core/reading/step:cap",
    ]);
  });

  test("a test's module prefix is a name; its law segment is the claim's anchor, never checked", () => {
    expect(
      keys({
        files: [
          "oracle/core/reading/step.limit-order.test.ts",
          "oracle/core/reading/cap.amount.test.ts",
        ],
      }),
    ).toEqual(["R3:undefined-word:oracle/core/reading/cap.amount.test.ts:cap"]);
  });

  test("a word matches a term or its plural, and a plural compound pluralises its last word", () => {
    const pluralKeys = (files: readonly string[]) =>
      nameCheck(snapshotOf({ terms: ["kind", "zone", "box", "running-total"], files })).map(
        (f) => f.debtKey,
      );
    expect(
      pluralKeys([
        "src/core/data/kinds.ts",
        "src/core/data/zones.ts",
        "src/core/data/boxes.ts",
        "src/core/data/running-totals.ts",
      ]),
    ).toEqual([]);
    expect(pluralKeys(["src/core/data/kindness.ts", "src/core/data/runnings-total.ts"])).toEqual([
      "R3:undefined-word:core/data/kindness:kindness",
      "R3:undefined-word:core/data/runnings-total:runnings",
      "R3:undefined-word:core/data/runnings-total:total",
    ]);
  });
});
