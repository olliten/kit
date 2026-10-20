import { expect, test } from "vitest";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { legacySize } from "../../src/core/readings/legacy-size.js";
import { moduleReferences } from "../../src/core/readings/module-references.js";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { proofReach } from "../../src/core/readings/proof-reach.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const gateSource =
  process.env.KIT_GATE_SOURCE ?? new URL("../../scripts/kit-check.mjs", import.meta.url).href;
const { ratchetFindings } = await import(gateSource);
const multi = (parts: Parameters<typeof snapshotOf>[0]) => {
  const snapshot = snapshotOf(parts);
  return {
    ...snapshot,
    config: { ...snapshot.config, srcRoot: ["src", "oracle"], oracleRoot: "proof" },
  };
};

test("the same dependency rules allow inward connections between roots", () => {
  expect(
    dependencyCheck(
      multi({
        imports: [
          "src/substrate/compositions/run.ts > oracle/core/readings/model.ts",
          "oracle/core/readings/model.ts > src/core/primitives/input.ts",
        ],
      }),
    ),
  ).toEqual([]);
});

test("forbidden edges and a cross-root cycle retain distinct module identities", () => {
  const findings = dependencyCheck(
    multi({
      imports: [
        "src/core/readings/value.ts > oracle/substrate/adapters/io.ts",
        "oracle/core/readings/value.ts > src/substrate/adapters/io.ts",
        "src/core/readings/value.ts > oracle/core/readings/value.ts",
        "oracle/core/readings/value.ts > src/core/readings/value.ts",
      ],
    }),
  );
  expect(findings.map((item) => item.debtKey)).toEqual([
    "R2:cycle:oracle/core/readings/value:oracle/core/readings/value,src/core/readings/value",
    "R2:edge:oracle/core/readings/value:src/substrate/adapters/io",
    "R2:edge:src/core/readings/value:oracle/substrate/adapters/io",
  ]);
});

test("names, comments and module references check both roots without key collisions", () => {
  const paths = ["src/core/readings/old.ts", "oracle/core/readings/old.ts"];
  const snapshot = multi({
    files: paths,
    terms: ["current · retired: old"],
    comments: paths.map((path) => `${path}#TODO`),
  });
  for (const check of [nameCheck, commentCheck, moduleReferences]) {
    const findings = check(snapshot);
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((item) => item.debtKey)).size).toBe(2);
    expect(findings.map((item) => item.path).sort()).toEqual([
      "oracle/core/readings/old",
      "src/core/readings/old",
    ]);
  }
});

test("legacy size and new-debt rejection include both roots and cross-root calls", () => {
  const paths = ["src/legacy/value.ts", "oracle/legacy/value.ts"];
  const model = "oracle/core/readings/model.ts";
  const snapshot = {
    ...multi({ files: [...paths, model] }),
    sizes: paths.map((file) => ({ file, statements: 2, calls: [model] })),
  };
  const findings = legacySize(snapshot);
  expect(findings.map((item) => [item.path, item.calls])).toEqual([
    [paths[1], 1],
    [paths[0], 1],
  ]);
  expect(ratchetFindings(findings, {}, [], [])).toHaveLength(2);
});

test("proof reach includes helpers in either root and rejects a missing named module", () => {
  const snapshot = multi({
    files: [
      "src/core/readings/total.ts",
      "oracle/core/readings/model.ts",
      "proof/topic/check.test.ts",
    ],
    imports: ["proof/topic/check.test.ts > oracle/core/readings/model.ts"],
    claims: [{ file: "spec/topic.md", anchor: "check", line: 1, terms: ["total", "model"] }],
  });
  expect(proofReach(snapshot).map((item) => item.debtKey)).toEqual([
    "R4:unreached-module:spec/topic.md:check:total",
  ]);
  expect(
    proofReach({
      ...snapshot,
      imports: [
        ...snapshot.imports,
        { from: "proof/topic/check.test.ts", to: "src/core/readings/total.ts" },
      ],
    }),
  ).toEqual([]);
});

test("a global module term cannot silently choose a same-named home in another root", () => {
  const snapshot = multi({
    files: ["src/core/readings/value.ts", "oracle/core/readings/value.ts"],
  });
  const result = termModel({
    ...snapshot,
    terms: [
      {
        term: "value",
        meaning: "",
        retired: [],
        line: 1,
        metadata: { kind: "module", role: "derived", zone: "core", references: [] },
      },
    ],
  });
  expect(result.findings.map((item) => item.debtKey)).toContain("R3:term-home:value:2");
});
