import { expect, test } from "vitest";
import { gate } from "../../src/core/compositions/gate.js";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { configIssues } from "../../src/core/readings/config-schema.js";
import { functionSize } from "../../src/core/readings/function-size.js";
import { ratchetFindings, tightenedBaseline } from "../../src/core/readings/ratchet.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const LIMIT = 8;
const limited: Partial<KitConfig> = { limits: { functionLines: LIMIT } };

// The statements of a body spanning `lines` lines once its opening and closing braces are counted.
const statements = (lines: number): string =>
  ["  let total = 0;", ...Array.from({ length: lines - 4 }, () => "  total += 1;"), "  return total;"].join("\n");
const named = (name: string, lines: number): string => `export function ${name}(): number {\n${statements(lines)}\n}\n`;

function sized(files: Readonly<Record<string, string>>, config: Partial<KitConfig> = limited) {
  const snapshot = sourceFixture(files, config);
  return gate(snapshot, snapshot.config).findings.filter((item) => item.debtKey.startsWith("R3:function-size:"));
}

const keys = (files: Readonly<Record<string, string>>, config: Partial<KitConfig> = limited): string[] =>
  sized(files, config).map((item) => item.debtKey);

test("a named function whose body spans more lines than the limit is a finding naming it, its lines and the limit", () => {
  const path = "src/core/readings/total.ts";
  const found = sized({
    [path]: named("under", LIMIT - 1) + named("at", LIMIT) + named("over", LIMIT + 1),
  });
  expect(found.map(({ debtKey, path: at, category, lines, fix }) => [debtKey, at, category, lines, fix])).toEqual([
    [
      `R3:function-size:${path}:over`,
      path,
      "placed-violation",
      LIMIT + 1,
      `over spans ${LIMIT + 1} lines, over the limit of ${LIMIT}: move parts of it into functions declared outside its body.`,
    ],
  ]);
  expect(found.every((item) => item.blocking)).toBe(true);
});

test("blank and comment lines inside a body count toward its span", () => {
  const path = "src/core/readings/total.ts";
  const padded = `export function padded(): number {\n${statements(LIMIT - 1)}\n\n  // Why the total is returned.\n}\n`;
  expect(keys({ [path]: padded })).toEqual([`R3:function-size:${path}:padded`]);
});

test("an anonymous function's lines count toward the named function holding it, and a named one's too", () => {
  const path = "src/core/readings/total.ts";
  const closure = `export function outer(values: readonly number[]): number[] {\n  return values.map((value) => {\n${statements(LIMIT)}\n  });\n}\n`;
  expect(keys({ [path]: closure })).toEqual([`R3:function-size:${path}:outer`]);
  const nested = `export function holder(): number {\n  function inner(): number {\n${statements(LIMIT - 2)}\n  }\n  return inner();\n}\n`;
  expect(keys({ [path]: nested })).toEqual([`R3:function-size:${path}:holder`]);
  const apart = `function inner(): number {\n${statements(LIMIT - 2)}\n}\nexport function holder(): number {\n  return inner();\n}\n`;
  expect(keys({ [path]: apart })).toEqual([]);
});

test("tests and files outside every code root and legacy location are not measured", () => {
  expect(keys({ "src/core/readings/total.test.ts": named("over", LIMIT + 1), "tools/total.ts": named("over", LIMIT + 1) })).toEqual(
    [],
  );
  const legacy = functionSize(sourceFixture({ "lib/total.ts": named("over", LIMIT + 1) }, { ...limited, layout: { legacy: ["lib"] } }));
  expect(legacy.map(({ debtKey, category }) => [debtKey, category])).toEqual([["R3:function-size:lib/total.ts:over", "legacy-debt"]]);
});

test("a placed function over the limit fails, and a legacy one is debt whose recorded lines may shrink but never grow", () => {
  const placed = "src/core/readings/total.ts";
  const legacy = "src/legacy/total.ts";
  const found = sized({ [placed]: named("over", LIMIT + 2), [legacy]: named("over", LIMIT + 2) });
  expect(found.map(({ path, category }) => [path, category])).toEqual([
    [placed, "placed-violation"],
    [legacy, "legacy-debt"],
  ]);
  const placedKey = `R3:function-size:${placed}:over`;
  const legacyKey = `R3:function-size:${legacy}:over`;
  const fails = (baseline: Readonly<Record<string, unknown>>) =>
    ratchetFindings(found, baseline, [placed], [], []).map(({ path, fix }) => [path, fix]);
  const fix = `over spans ${LIMIT + 2} lines, over the limit of ${LIMIT}: move parts of it into functions declared outside its body.`;
  expect(fails({ [placedKey]: { lines: LIMIT + 2 }, [legacyKey]: { lines: LIMIT + 2 } })).toEqual([[placed, fix]]);
  expect(fails({ [legacyKey]: { lines: LIMIT + 5 } })).toEqual([[placed, fix]]);
  expect(fails({ [legacyKey]: { lines: LIMIT + 1 } })).toEqual([
    [placed, fix],
    [legacy, `${fix} Its baseline records ${LIMIT + 1}, and a legacy function may only shrink.`],
  ]);
  expect(fails({ [legacyKey]: null })).toEqual([
    [placed, fix],
    [legacy, `${fix} The baseline records no lines for it, so it is new debt.`],
  ]);
  expect(tightenedBaseline({ [legacyKey]: { lines: LIMIT + 5 } }, found)).toEqual({ [legacyKey]: { lines: LIMIT + 2 } });
  expect(tightenedBaseline({ [legacyKey]: { lines: LIMIT + 1 } }, found)).toEqual({ [legacyKey]: { lines: LIMIT + 1 } });
  expect(tightenedBaseline({ [legacyKey]: { lines: LIMIT + 5 } }, [])).toEqual({});
});

test("without a declared limit no function is measured", () => {
  expect(keys({ "src/core/readings/total.ts": named("over", 200) }, {})).toEqual([]);
});

test("limits.functionLines is a whole number of lines above zero, and limits declares no other key", () => {
  const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
  expect(configuredKit(DEFAULT_CONFIG, { roots, limits: { functionLines: 120 } }).limits).toEqual({ functionLines: 120 });
  expect(configuredKit(DEFAULT_CONFIG, { roots }).limits).toBeUndefined();
  for (const functionLines of [0, -3, 1.5, "120", null, undefined])
    expect(() => configuredKit(DEFAULT_CONFIG, { roots, limits: { functionLines } })).toThrow(
      "Declare limits as a mapping whose functionLines is a whole number of lines above zero, such as 120.",
    );
  expect(() => configuredKit(DEFAULT_CONFIG, { roots, limits: 120 })).toThrow(/functionLines is a whole number/);
  expect(configIssues({ roots, limits: { functionLines: 120, statements: 10 } }).map((issue) => issue.key)).toEqual([
    "limits.statements",
  ]);
});
