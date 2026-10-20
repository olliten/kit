import { describe, expect, test } from "vitest";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

function inspect(srcRoot: string, ...edges: readonly [string, string][]) {
  const snapshot = snapshotOf({
    files: edges.flatMap((edge) => edge.map((path) => `${srcRoot}/${path}.ts`)),
    imports: edges.map(([from, to]) => `${srcRoot}/${from}.ts > ${srcRoot}/${to}.ts`),
  });
  return dependencyCheck({ ...snapshot, config: { ...snapshot.config, srcRoot } });
}

describe.each(["src", "oracle"])("adapter rules under the single configured root %s", (srcRoot) => {
  test("an adapter has a canonical module identity", () => {
    expect(placementOf(`${srcRoot}/shell/adapters/focus.ts`, srcRoot)).toEqual({
      placed: true,
      zone: "shell",
      layer: "adapters",
      name: "focus",
      rest: "ts",
      artifact: "shell/adapters/focus",
    });
  });

  test.each([
    ["substrate/primitives/value", "substrate/adapters/clock"],
    ["substrate/readings/value", "substrate/adapters/clock"],
    ["substrate/adapters/clock", "substrate/readings/value"],
    ["substrate/adapters/clock", "substrate/compositions/run"],
    ["substrate/adapters/clock", "substrate/adapters/timer"],
    ["substrate/adapters/clock", "core/readings/value"],
    ["core/compositions/run", "substrate/adapters/clock"],
    ["shell/compositions/run", "substrate/adapters/clock"],
  ])("%s cannot import %s", (from, to) => {
    expect(inspect(srcRoot, [from, to])).toEqual([
      expect.objectContaining({ rule: "R2", debtKey: `R2:edge:${from}:${to}` }),
    ]);
  });

  test.each([
    ["substrate/adapters/clock", "substrate/primitives/instant"],
    ["substrate/adapters/clock", "core/primitives/instant"],
    ["substrate/compositions/run", "substrate/adapters/clock"],
    ["shell/compositions/run", "shell/adapters/focus"],
    ["core/readings/label", "core/readings/value"],
  ])("%s may import %s", (from, to) => {
    expect(inspect(srcRoot, [from, to])).toEqual([]);
  });

  test("adapter placement does not exempt an import cycle", () => {
    const a = "substrate/adapters/clock";
    const b = "substrate/primitives/value";
    expect(inspect(srcRoot, [a, b], [b, a])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "R2", debtKey: expect.stringContaining("R2:cycle:") }),
      ]),
    );
  });
});
