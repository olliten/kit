import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { placementOf } from "../../src/core/readings/placement-of.js";

function inspect(from: string, to: string): ReturnType<typeof dependencyCheck> {
  const snapshot: Snapshot = {
    config: DEFAULT_CONFIG,
    files: [from, to].map((path) => ({ path, type: "source" })),
    imports: [{ from, to }],
    terms: [],
    prose: [],
    symbols: [],
    comments: [],
  };
  return dependencyCheck(snapshot);
}

test("an adapter has a canonical module identity", () => {
  expect(placementOf("src/shell/adapters/focus.ts", "src")).toEqual({
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
  expect(inspect(`src/${from}.ts`, `src/${to}.ts`)).toEqual([
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
  expect(inspect(`src/${from}.ts`, `src/${to}.ts`)).toEqual([]);
});

test("adapter placement does not exempt an import cycle", () => {
  const a = "src/substrate/adapters/clock.ts";
  const b = "src/substrate/primitives/value.ts";
  const snapshot: Snapshot = {
    config: DEFAULT_CONFIG,
    files: [],
    imports: [
      { from: a, to: b },
      { from: b, to: a },
    ],
    terms: [],
    prose: [],
    symbols: [],
    comments: [],
  };
  expect(dependencyCheck(snapshot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: "R2", debtKey: expect.stringContaining("R2:cycle:") }),
    ]),
  );
});
