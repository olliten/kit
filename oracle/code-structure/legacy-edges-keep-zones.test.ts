import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { edgeCheck } from "../../src/core/readings/edge-check.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

// The fixture's import edges, what they carry, and what the import, edge and zone checks find in them; a
// fixture that doesn't compile throws.
function inspect(files: Readonly<Record<string, string>>, config: KitConfig = DEFAULT_CONFIG) {
  const snapshot = projectSnapshot(recordedImports(files, config), config);
  const context = capabilityContext(snapshot, []);
  const parts = [importAuthority(snapshot, context)];
  const edges = edgeCheck(snapshot, context);
  const graph = authorityGraph(snapshot, context, parts, edges.crossZoneFailures);
  return {
    requirements: [...graph.inherited].map(([path, capabilities]) => ({ path, inherited: [...capabilities].sort() })),
    findings: [
      ...parts.flatMap((part) => part.findings),
      ...edges.findings,
      ...zoneAuthorityCheck(snapshot, context, graph),
    ],
  };
}

describe("migration edges use actual zones and transitive capabilities", () => {
  test("legacy Core cannot import a placed Shell module even when the Shell export is pure", () => {
    const path = "src/core/legacy/run.ts";
    const result = inspect({
      [path]:
        "import { label } from '../../shell/readings/label.js';\nexport function run(): string { return label(); }\n",
      "src/shell/readings/label.ts": "export function label(): string { return 'label'; }\n",
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, status: "violation", blocking: true }),
      ]),
    );
  });

  test("legacy Core can call a placed pure Core reading without inventing a legacy layer", () => {
    const result = inspect({
      "src/core/legacy/run.ts":
        "import { offset } from '../readings/offset.js';\nexport function run(value: number): number { return offset(value); }\n",
      "src/core/readings/offset.ts":
        "export function offset(value: number): number { return value + 1; }\n",
    });
    expect(result.findings).toEqual([]);
  });

  test("a placed reading cannot launder write production through a legacy re-export", () => {
    const path = "src/core/readings/value.ts";
    const result = inspect(
      {
        "src/core/compositions/save-value.ts":
          "export interface WriteSet { readonly value: number; }\nexport function save(value: number): WriteSet { return { value }; }\n",
        "src/core/legacy/save.ts": "export { save } from '../compositions/save-value.js';\n",
        [path]:
          "import { save } from '../legacy/save.js';\nexport function value(input: number): number { return save(input).value; }\n",
      },
      {
        ...DEFAULT_CONFIG,
        adapters: [
          {
            module: "core/compositions/save-value",
            export: "save",
            capability: "value.produce",
            kind: "produce",
            zones: ["core"],
          },
        ],
      },
    );
    expect(result.requirements.find((row) => row.path === path)?.inherited).toContain(
      "value.produce",
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, status: "violation", blocking: true }),
      ]),
    );
  });
});

test("recognizing a private local contract preserves the original migration limits", () => {
  const localConsumer = "src/substrate/compositions/local-record.ts";
  const run = "src/substrate/compositions/run.ts";
  const files = {
    "src/substrate/adapters/local-journal.ts":
      "interface LocalJournal { note(text: string): void; open(): ReadPort; }\n" +
      "interface ReadPort { read(): string; }\n" +
      "export function journal(): LocalJournal { return { note: () => {}, open: () => ({ read: () => '' }) }; }\n",
    [localConsumer]:
      "import { journal } from '../adapters/local-journal.js';\n" +
      "export function record(value: ReturnType<typeof journal>): void { value.note('a'); }\n" +
      "export function readPort(value: ReturnType<ReturnType<typeof journal>['open']>): string { return value.read(); }\n",
    [run]:
      "export function run(read: () => string, write: (value: string) => void): void { write(read()); }\n",
    "legacy/index.ts":
      "import { record, readPort } from '../src/substrate/compositions/local-record.js';\nvoid record; void readPort;\n" +
      "import { run } from '../src/substrate/compositions/run.js'; void run;\n",
  };
  const config: KitConfig = {
    ...DEFAULT_CONFIG,
    layout: { legacy: ["legacy"] },
    adapters: [{
      module: "substrate/adapters/local-journal",
      export: "journal",
      capability: "journal",
      kind: "external",
      zones: ["substrate"],
      contract: { type: "LocalJournal" },
    }],
  };
  // The existing compiler fixture refuses invalid programs before recording their import edges.
  let actual: ReturnType<typeof inspect> = { requirements: [], findings: [] };
  expect(() => { actual = inspect(files, config); }).not.toThrow();
  const migration = actual.findings.filter((item) => item.debtKey.includes("migration-zone"));
  expect(migration.map((item) => item.debtKey)).toEqual([
    `R1:migration-zone:legacy/index.ts:${localConsumer}`,
    `R1:migration-zone:legacy/index.ts:${run}`,
  ]);
});

// Every possible declared origin admits an inward Core edge. An unknown legacy origin has no
// layer, so choosing any of those origins cannot turn the same Core destination into an outward edge.
const originZones = [undefined, "core", "shell", "substrate"] as const;
const coreTargets = [
  ["primitives", "export interface Value { readonly amount: number; }", "import type { Value }", "export function read(value: Value): number { return value.amount; }"],
  ["readings", "export function value(input: number): number { return input + 1; }", "import { value }", "export function read(input: number): number { return value(input); }"],
  ["compositions", "export function value(input: number): number { return input + 1; }", "import { value }", "export function read(input: number): number { return value(input); }"],
] as const;

test.each(originZones)("legacy origin %s may consume each pure Core layer", (zone) => {
  for (const [layer, declaration, imported, body] of coreTargets) {
    const result = inspect({
      "legacy/read.ts": `${imported} from '../src/core/${layer}/value.js';\n${body}\n`,
      [`src/core/${layer}/value.ts`]: declaration,
    }, {
      ...DEFAULT_CONFIG,
      layout: { legacy: ["legacy"] },
      ...(zone === undefined ? {} : { legacyZones: [{ root: "legacy", zone }] }),
    });
    expect(result.findings, `${String(zone)} -> core/${layer}`).toEqual([]);
  }
});

test.each(["shell", "substrate"])("unknown legacy origin still needs a zone before importing %s", (zone) => {
  const path = "legacy/read.ts";
  const target = `src/${zone}/readings/value.ts`;
  const result = inspect({
    [path]: `import { value } from '../${target.replace(/\.ts$/, ".js")}';\nexport function read(): number { return value(); }`,
    [target]: "export function value(): number { return 1; }",
  }, { ...DEFAULT_CONFIG, layout: { legacy: ["legacy"] } });
  expect(result.findings.map((finding) => finding.debtKey)).toEqual([
    `R1:migration-zone:${path}:${target}`,
  ]);
});

test("a known Core origin cannot establish an unknown legacy target's zone", () => {
  const path = "src/core/compositions/read.ts";
  const target = "legacy/value.ts";
  const result = inspect({
    [path]: "import { value } from '../../../legacy/value.js';\nexport function read(): number { return value(); }",
    [target]: "export function value(): number { return 1; }",
  }, { ...DEFAULT_CONFIG, layout: { legacy: ["legacy"] } });
  expect(result.findings.map((finding) => finding.debtKey)).toEqual([
    `R1:migration-zone:${path}:${target}`,
  ]);
});

test("inward migration does not exempt cycles through the legacy caller", () => {
  const result = inspect({
    "legacy/read.ts": "import { value } from '../src/core/readings/value.js';\nexport function read(): number { return value(); }",
    "src/core/readings/value.ts": "import { read } from '../../../legacy/read.js';\nexport function value(): number { return read(); }",
  }, { ...DEFAULT_CONFIG, layout: { legacy: ["legacy"] } });
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ debtKey: expect.stringContaining("R2:cycle:"), blocking: true }),
  ]));
});

test("an unknown legacy caller still inherits native authority forbidden in its Core dependency", () => {
  const target = "src/core/compositions/read.ts";
  const native = "src/substrate/adapters/clock.ts";
  const result = inspect({
    "legacy/run.ts": "import { read } from '../src/core/compositions/read.js';\nexport { read };",
    [target]: "import { now } from '../../substrate/adapters/clock.js';\nexport function read(): number { return now(); }",
    [native]: "export function now(): number { return 1; }",
  }, {
    ...DEFAULT_CONFIG,
    layout: { legacy: ["legacy"] },
    adapters: [{ module: "substrate/adapters/clock", export: "now", capability: "clock", kind: "external", zones: ["substrate"] }],
  });
  expect(result.requirements.find((row) => row.path === target)?.inherited).toContain("clock");
  expect(result.requirements.find((row) => row.path === "legacy/run.ts")?.inherited).toContain("clock");
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: target, blocking: true, status: "violation", debtKey: `R1:zone-authority:${target}:clock` }),
  ]));
  expect(result.findings.some((finding) => finding.debtKey.includes("migration-zone:legacy/run.ts:"))).toBe(false);
});
