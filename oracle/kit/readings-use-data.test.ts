import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { saveValue } from "../../fixture/capabilities/src/core/compositions/save-value.js";
import type { ScoredValue } from "../../fixture/capabilities/src/core/primitives/scored-value.js";
import type { transformedValue } from "../../fixture/capabilities/src/core/readings/data-input.js";
import type { valueOrder } from "../../fixture/capabilities/src/core/readings/value-order.js";
import { sourceLoader } from "../../src/substrate/adapters/source-loader.mjs";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { cases } from "../core/primitives/case-inventory.js";

const fixtureRoot = fileURLToPath(new URL("../../fixture/capabilities/", import.meta.url));

// The fixture app's own code runs as loaded source, never as an import of the oracle's.
const fixture = await sourceLoader.load(fixtureRoot, [
  "src/core/readings/value-order.ts",
  "src/core/readings/data-input.ts",
  "src/core/compositions/save-value.ts",
]);
const isValueOrder = (value: unknown): value is typeof valueOrder => typeof value === "function";
const isTransformedValue = (value: unknown): value is typeof transformedValue => typeof value === "function";
const isSaveValue = (value: unknown): value is typeof saveValue => typeof value === "function";
const order = fixture["valueOrder"];
const transform = fixture["transformedValue"];
const save = fixture["saveValue"];
if (!isValueOrder(order) || !isTransformedValue(transform) || !isSaveValue(save))
  throw new Error("The fixture app's readings did not load.");

test("the real snapshot reader discovers every independently supplied case input", () => {
  const snapshot = readSnapshot(fixtureRoot);
  const paths = new Set(snapshot.files.map((file) => file.path));
  for (const fixture of cases)
    for (const path of fixture.paths) expect(paths.has(path), `${fixture.id}: ${path}`).toBe(true);
  expect(snapshot.files.some((file) => file.path.includes("case-inventory"))).toBe(false);
  expect(snapshot.imports).toContainEqual(
    expect.objectContaining({
      from: "src/substrate/primitives/cell-exports.ts",
      to: "src/substrate/primitives/cell-store.ts",
    }),
  );
});

describe("meaningful comparator and local mapper over supplied data", () => {
  const rows: readonly {
    readonly name: string;
    readonly values: readonly ScoredValue[];
    readonly expected: readonly string[];
  }[] = [
    {
      name: "offset changes the ordering of limits",
      values: [
        { id: "late", limit: 120, offset: 20 },
        { id: "long", limit: 130, offset: 50 },
        { id: "unset", limit: null, offset: 10 },
      ],
      expected: ["long", "late", "unset"],
    },
    {
      name: "equal adjusted limits use deterministic identity order",
      values: [
        { id: "b", limit: 120, offset: 20 },
        { id: "a", limit: 110, offset: 10 },
      ],
      expected: ["a", "b"],
    },
    {
      name: "absent bounds use deterministic identity order",
      values: [
        { id: "unset-b", limit: null, offset: 0 },
        { id: "unset-a", limit: null, offset: 0 },
      ],
      expected: ["unset-a", "unset-b"],
    },
  ];

  test.each(rows)("$name without mutating its input", ({ values, expected }) => {
    const original = structuredClone(values);
    const input = Object.freeze(values.map((value) => Object.freeze({ ...value })));
    expect(order(input)).toEqual(expected);
    expect(input).toEqual(original);
  });
});

test("the plain data neighbour reads a choice rather than a supplied callback", () => {
  expect(transform({ value: "  next  ", options: { trim: true } })).toBe("next");
  expect(transform({ value: "  next  ", options: { trim: false } })).toBe("  next  ");
});

test("the actual composition branches on validation and returns a complete write description", () => {
  expect(save("one", "too-long", 3)).toEqual({ kind: "invalid", reason: "value-too-long" });
  expect(save("one", "yes", 3)).toEqual({
    kind: "accepted",
    writes: [{ kind: "put-cell", key: "one", value: "yes" }],
  });
});
