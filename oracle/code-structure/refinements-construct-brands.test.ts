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

const ROW_ID = "src/core/primitives/row-id.ts";
const BRANDS = [
  "type Brand<T, K extends string> = T & { readonly __brand: K };",
  "type RowId = Brand<string, 'RowId'>;",
  "type Loose = string & { label: string };",
  "export function rowIdOf(value: string): RowId {",
  "  if (!/^r[0-9]+$/.test(value)) throw new Error('not a row id');",
  "  return value as RowId;",
  "}",
  "export const maybeRowId = (value: string): RowId | null => (value.startsWith('r') ? (value as RowId) : null);",
  "export function unchecked(value: string): RowId { return value as RowId; }",
  "export function loose(value: string): Loose {",
  "  if (value === '') throw new Error('empty');",
  "  return value as Loose;",
  "}",
  "export function plain(value: string): string { return value; }",
  "",
].join("\n");

// The compiler and refinement findings of the brands fixture with the given registrations, the given exports of
// it called directly from a test.
function refined(registered: readonly string[], called: readonly string[]) {
  const recorded = recordedEscapes({ "tsconfig.json": TSCONFIG, [ROW_ID]: BRANDS });
  const proof = { file: "oracle/row-id.test.ts", reached: [ROW_ID], whole: [], declarations: called.map((name) => ({ file: ROW_ID, name })) };
  const snapshot = projectSnapshot(
    { ...recorded, proofs: [proof] },
    { refinements: registered.map((name) => ({ module: ROW_ID, export: name })) },
  );
  const findings = compilerCheck(snapshot, capabilityContext(snapshot, []));
  return {
    escapes: findings.filter((row) => row.debtKey.startsWith("R1:type-escape:")).map((row) => row.debtKey),
    refinements: findings.filter((row) => row.debtKey.startsWith("R1:refinement-")).map((row) => row.debtKey),
  };
}

test("a registered constructor's checked assertion to its branded result is no escape", () => {
  const { escapes, refinements } = refined(["rowIdOf", "maybeRowId"], ["rowIdOf", "maybeRowId"]);
  expect(refinements).toEqual([]);
  expect(escapes.some((key) => key.includes("rowIdOf") || key.includes("maybeRowId"))).toBe(false);
  expect(escapes.some((key) => key.includes("unchecked"))).toBe(true);
  expect(escapes.some((key) => key.includes("loose"))).toBe(true);
});

test("a registration that is unbranded, unchecked, untested or asserts nothing is a finding and allows nothing", () => {
  const { escapes, refinements } = refined(["unchecked", "loose", "rowIdOf", "plain"], ["unchecked", "loose", "plain"]);
  expect(refinements.sort()).toEqual(
    [
      `R1:refinement-unchecked:${ROW_ID}:unchecked`,
      `R1:refinement-brand:${ROW_ID}:loose`,
      `R1:refinement-untested:${ROW_ID}:rowIdOf`,
      `R1:refinement-assertion:${ROW_ID}:plain`,
    ].sort(),
  );
  for (const name of ["unchecked", "loose", "rowIdOf"]) expect(escapes.some((key) => key.includes(name))).toBe(true);
});
