import { expect, test } from "vitest";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { compilerCheck } from "../../src/core/readings/compiler-check.js";
import { configIssues } from "../../src/core/readings/config-schema.js";
import { configuredRefinements } from "../../src/core/readings/refinement-configuration.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedEscapes } from "../substrate/compositions/recorded-escapes.js";

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", strict: true, types: [], noEmit: true },
  include: ["src/**/*.ts"],
});

test("an app registers refinement constructors by module and export, each once", () => {
  const read = (refinements: unknown) => configuredRefinements(refinements);
  expect(read([{ module: "./src/core/primitives/row-id.ts", export: "rowIdOf" }])).toEqual([
    { module: "src/core/primitives/row-id.ts", export: "rowIdOf" },
  ]);
  expect(() => read([{ module: "src/core/primitives/row-id.ts" }])).toThrow(/refinements\[0\]/);
  expect(() => read([{ module: "/abs/row-id.ts", export: "rowIdOf" }])).toThrow(/refinements\[0\]/);
  expect(() =>
    read([
      { module: "src/core/primitives/row-id.ts", export: "rowIdOf" },
      { module: "src/core/primitives/./row-id.ts", export: "rowIdOf" },
    ]),
  ).toThrow(/refinements\[1\] repeats/);
  expect(() => read({ module: "src/core/primitives/row-id.ts", export: "rowIdOf" })).toThrow(/list of rows/);
  expect(configIssues({ refinements: [{ module: "a.ts", export: "a", why: "x" }] }).map((issue) => issue.key)).toEqual([
    "refinements[0].why",
  ]);
});

test("an assertion outside a registered refinement constructor stays a type escape", () => {
  const path = "src/core/primitives/row-id.ts";
  const source = [
    "type RowId = string & { readonly __brand: 'RowId' };",
    "export function rowIdOf(value: string): RowId {",
    "  if (!/^r[0-9]+$/.test(value)) throw new Error('not a row id');",
    "  return value as RowId;",
    "}",
    "export function unchecked(value: string): RowId { return value as RowId; }",
    "",
  ].join("\n");
  const snapshot = projectSnapshot(recordedEscapes({ "tsconfig.json": TSCONFIG, [path]: source }), {
    refinements: [{ module: path, export: "rowIdOf" }],
  });
  const escapes = compilerCheck(snapshot, capabilityContext(snapshot, [])).filter(
    (row) => row.path === path && row.debtKey.startsWith("R1:type-escape:"),
  );
  expect(escapes.map((row) => row.debtKey)).toEqual(expect.arrayContaining([expect.stringMatching(/unchecked/)]));
  expect(escapes.every((row) => row.status === "violation" && row.blocking)).toBe(true);
});
