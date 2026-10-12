import { describe, expect, test } from "vitest";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const keys = (parts: Parameters<typeof snapshotOf>[0]) =>
  nameCheck(snapshotOf({ terms: ["step", "limit", "amount", "running-total"], ...parts })).map(
    (f) => f.debtKey,
  );

describe("nameCheck: module names and exported symbols use only terms and connectors", () => {
  test("a name of terms has no finding", () => {
    expect(
      keys({
        files: ["src/core/readings/step-limit.ts", "oracle/topic/step-limit-holds.test.ts"],
      }),
    ).toEqual([]);
  });

  test("an undefined word is a finding, and its fix names the term to define", () => {
    const [f, ...rest] = nameCheck(snapshotOf({ files: ["src/core/readings/cap.ts"] }));
    expect(rest).toEqual([]);
    expect(f?.debtKey).toBe("R3:undefined-word:core/readings/cap:cap");
    expect(f?.fix).toContain("- **cap** —");
  });

  test("a compound term matches before its parts, in kebab, camelCase and snake alike", () => {
    const at = "src/core/compositions/running-total.ts";
    expect(keys({ files: [at], symbols: [`${at}#runningTotal`, `${at}#RUNNING_TOTAL`] })).toEqual(
      [],
    );
    expect(keys({ files: ["src/core/compositions/total-running.ts"] })).toEqual([
      "R3:undefined-word:core/compositions/total-running:running",
      "R3:undefined-word:core/compositions/total-running:total",
    ]);
  });

  test("connectors need no term", () => {
    expect(keys({ files: ["src/core/readings/limit-of-the-step.ts"] })).toEqual([]);
  });

  test("zone and layer segments are structure, never checked; legacy files are not held", () => {
    expect(
      keys({ files: ["src/shell/compositions/step.ts", "src/main.ts", "src/util/stuff.ts"] }),
    ).toEqual([]);
  });

  test("camelCase symbols split on case boundaries", () => {
    const at = "src/core/readings/step.ts";
    expect(keys({ symbols: [`${at}#stepLimit`, `${at}#AmountStep`, `${at}#stepCap`] })).toEqual([
      "R3:undefined-word:core/readings/step:cap",
    ]);
  });

  test("claim-first proof anchors do not need separate term definitions", () => {
    expect(
      keys({
        files: ["oracle/topic/step-limit-order.test.ts", "oracle/topic/cap-amount.test.ts"],
      }),
    ).toEqual([]);
  });

  test("claim-first proof names still reject explicitly retired words", () => {
    expect(
      keys({
        terms: ["amount"],
        files: ["oracle/topic/total-sums.test.ts"],
      }),
    ).toEqual([]);
    expect(
      keys({
        terms: ["amount · retired: sums"],
        files: ["oracle/topic/total-sums.test.ts"],
      }),
    ).toEqual(["R3:retired-word:oracle/topic/total-sums.test.ts:sums"]);
  });

  test("a word matches a term or its plural, and a plural compound pluralises its last word", () => {
    const pluralKeys = (files: readonly string[]) =>
      nameCheck(snapshotOf({ terms: ["kind", "zone", "box", "running-total"], files })).map(
        (f) => f.debtKey,
      );
    expect(
      pluralKeys([
        "src/core/primitives/kinds.ts",
        "src/core/primitives/zones.ts",
        "src/core/primitives/boxes.ts",
        "src/core/primitives/running-totals.ts",
      ]),
    ).toEqual([]);
    expect(
      pluralKeys(["src/core/primitives/kindness.ts", "src/core/primitives/runnings-total.ts"]),
    ).toEqual([
      "R3:undefined-word:core/primitives/kindness:kindness",
      "R3:undefined-word:core/primitives/runnings-total:runnings",
      "R3:undefined-word:core/primitives/runnings-total:total",
    ]);
  });
});
