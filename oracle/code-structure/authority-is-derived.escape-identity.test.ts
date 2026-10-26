import { expect, test } from "vitest";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const LEGACY = "src/legacy/value.ts";
const PLACED = "src/core/readings/value.ts";
const IMPORT = 'import type { Tag } from "./tag.js";\n// An unrelated leading comment.\n\n';

function extract(source: string, path = LEGACY) {
  const snapshot = sourceFixture({
    [path]: source,
    [path.replace("value.ts", "tag.ts")]: "export interface Tag { readonly value: string; }\n",
  }, { legacyZones: [{ root: "src/legacy", zone: "core" }] });
  const facts = snapshot.compiler?.projects.flatMap((p) => p.escapes)
    .filter((escape) => escape.file === path) ?? [];
  expect(facts.length, "the actual compiler must extract an escape").toBeGreaterThan(0);
  const findings = capabilityCheck(snapshot).findings
    .filter((finding) => finding.path === path && finding.debtKey.startsWith("R1:type-escape:"));
  expect(findings).toHaveLength(facts.length);
  return { facts, findings, keys: findings.map((f) => f.debtKey) };
}

test.each([
  ["assertion", "export function read(input: unknown): string { return input as string; }\n"],
  ["non-null", "export function read(input: string | null): string { return input!; }\n"],
  ["any", "export function read(input: any): unknown { return input; }\n"],
  ["ignore", "// @ts-ignore\nexport const value: number = 'bad';\n"],
  ["expect-error", "// @ts-expect-error\nexport const value: number = 'bad';\n"],
  ["nocheck", "// @ts-nocheck\nexport const value: number = 'bad';\n"],
] as const)("%s debt identity survives an unrelated import and comment shifting every byte offset", (kind, source) => {
  const before = extract(source);
  const after = extract(IMPORT + source);
  expect(before.facts.map((f) => f.kind)).toContain(kind);
  expect(after.facts[0]!.start).toBeGreaterThan(before.facts[0]!.start);
  expect(after.keys).toEqual(before.keys);
  expect(before.findings.every((f) => f.category === "legacy-debt")).toBe(true);
});

test("comments and whitespace within an expression preserve its existing identity", () => {
  const before = extract("export function read(input: unknown): string { return input as string; }");
  const after = extract("export function read(input: unknown): string { return (input /* unchanged value */ as   string); }");
  expect(after.keys).toEqual(before.keys);
});

test("a changed expression or named enclosing scope is new debt, even with the same escape kind and count", () => {
  const original = "export function read(input: unknown, other: unknown): string { return input as string; }";
  const before = extract(original);
  const changedExpression = extract(original.replace("return input", "return other"));
  const changedScope = extract(original.replace("function read(", "function write("));
  expect(changedExpression.keys).toHaveLength(before.keys.length);
  expect(changedScope.keys).toHaveLength(before.keys.length);
  expect(changedExpression.keys.filter((key) => !before.keys.includes(key))).toHaveLength(1);
  expect(changedScope.keys.filter((key) => !before.keys.includes(key))).toHaveLength(1);
});

test("an added same-syntax occurrence keeps the existing debt and creates a distinct new site", () => {
  const once = "export function read(input: unknown): unknown { input as string; return input; }";
  const before = extract(once);
  const after = extract(once.replace("input as string;", "input as string; input as string;"));
  expect(before.keys).toHaveLength(1);
  expect(after.keys).toHaveLength(2);
  expect(new Set(after.keys).size).toBe(2);
  expect(after.keys).toContain(before.keys[0]);
  expect(after.keys.filter((key) => !before.keys.includes(key))).toHaveLength(1);
});

test("the same cast in a second named scope is additional debt, and neither scope masks the other", () => {
  const source = "export function read(input: unknown): string { return input as string; }\n";
  const before = extract(source);
  const after = extract(source + source.replace("function read", "function write"));
  expect(after.keys).toHaveLength(2);
  expect(new Set(after.keys).size).toBe(2);
  expect(after.keys).toContain(before.keys[0]);
  expect(after.keys.filter((key) => !before.keys.includes(key))).toHaveLength(1);
});

test.each([
  ["line-comment-looking regex", "export function read(): unknown { return /a\\/\\/alpha/ as unknown; }"],
  ["block-comment-looking regex", "export function read(): unknown { return /a\\/\\*alpha/ as unknown; }"],
  ["line-comment-looking template", "export function read(): string { return `before // alpha\n after` as string; }"],
  ["block-comment-looking template", "export function read(): string { return `before /* alpha */ after` as string; }"],
  ["quoted content", 'export function read(): string { return "before /* alpha */ // after" as string; }'],
] as const)("%s remains source content: changing its literal value creates a new escape identity", (_name, source) => {
  const before = extract(source);
  const after = extract(source.replace("alpha", "bravo"));
  expect(before.keys).toHaveLength(1);
  expect(after.keys).toHaveLength(1);
  expect(after.keys[0]).not.toBe(before.keys[0]);
  const commented = extract("// unrelated leading comment\n" + source.replace(" as ", " /* actual outside comment */ as "));
  expect(commented.keys).toEqual(before.keys);
});

test("a placed type escape always blocks, independent of whether its semantic key was seen before", () => {
  const source = "export function read(input: unknown): string { return input as string; }";
  const before = extract(source, PLACED);
  const after = extract(IMPORT + source, PLACED);
  expect(after.keys).toEqual(before.keys);
  for (const finding of [...before.findings, ...after.findings]) {
    expect(finding.status).toBe("violation");
    expect(finding.category).toBe("placed-violation");
    expect(finding.blocking).toBe(true);
  }
});

test.each([
  ["dynamic access", "R1:authority-entry:", "export function read(): unknown { return (globalThis as Record<string, unknown>)['x']; }\n"],
  ["a dynamic import", "R1:authority-entry:", "export function read(name: string): unknown { return import(name); }\n"],
])("%s keeps its debt key when an edit above it shifts every offset", (_, check, source) => {
  const keys = (text: string): string[] =>
    capabilityCheck(sourceFixture({ [LEGACY]: text }, { legacyZones: [{ root: "src/legacy", zone: "core" }] }))
      .findings.filter((finding) => finding.path === LEGACY && finding.debtKey.startsWith(check))
      .map((finding) => finding.debtKey);
  const before = keys(source);
  expect(before.length).toBeGreaterThan(0);
  expect(keys("// An unrelated leading comment.\n\n" + source)).toEqual(before);
});
