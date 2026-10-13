import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

function inspect(layerNames?: KitConfig["layerNames"]) {
  const root = mkdtempSync(join(tmpdir(), "kit-layer-input-"));
  const { primitives, readings, compositions } = layerNames ?? {
    primitives: "primitives",
    readings: "readings",
    compositions: "compositions",
  };
  const config: KitConfig = {
    ...DEFAULT_CONFIG,
    ...(layerNames === undefined ? {} : { layerNames }),
    adapters: [
      {
        module: "substrate/primitives/store",
        export: "put",
        capability: "cell.apply",
        kind: "apply",
        zones: ["substrate"],
        contract: { type: "Writer" },
      },
    ],
  };
  const inputs: Readonly<Record<string, string>> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022"],
        types: [],
        strict: true,
        noEmit: true,
        declaration: true,
        isolatedDeclarations: true,
      },
      include: ["src/**/*.ts"],
    }),
    [`src/substrate/${primitives}/store.ts`]:
      "export interface Writer { readonly put: (value: string) => void; }\n" +
      "export function put(writer: Writer, value: string): void { writer.put(value); }\n",
    [`src/substrate/${readings}/write.ts`]:
      `import { put } from '../${primitives}/store.js';\n` +
      `import type { Writer } from '../${primitives}/store.js';\n` +
      "export function write(writer: Writer, value: string): string { put(writer, value); return value; }\n",
    [`src/core/${readings}/legacy-value.ts`]:
      "import { legacyValue } from '../legacy/value.js';\n" +
      "export function value(): number { return legacyValue(); }\n",
    "src/core/legacy/value.ts": "export function legacyValue(): number { return 7; }\n",
    [`src/core/${compositions}/pure.ts`]:
      "export function result(value: number): { readonly value: number } { return { value }; }\n",
  };
  try {
    for (const [path, source] of Object.entries(inputs)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    const snapshot = readSnapshot(root, config);
    return capabilityCheck(snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each([
  {
    name: "canonical",
    primitives: "primitives",
    adapters: "adapters",
    readings: "readings",
    compositions: "compositions",
  },
  {
    name: "legacy physical directories",
    primitives: "state",
    adapters: "adapters",
    readings: "reading",
    compositions: "effect",
  },
])(
  "$name map to the same roles while tracing actual local legacy sources",
  ({ primitives, adapters, readings, compositions }) => {
    const actual = inspect({ primitives, adapters, readings, compositions });
    const store = `src/substrate/${primitives}/store.ts`;
    const writer = `src/substrate/${readings}/write.ts`;
    const legacy = `src/core/${readings}/legacy-value.ts`;
    const composition = `src/core/${compositions}/pure.ts`;
    expect(actual.requirements.map((row) => row.path).sort()).toEqual(
      [store, writer, legacy, composition, "src/core/legacy/value.ts"].sort(),
    );
    expect(actual.requirements.find((row) => row.path === store)?.direct).toEqual(["cell.apply"]);
    expect(actual.requirements.find((row) => row.path === writer)?.inherited).toEqual([
      "cell.apply",
    ]);
    expect(actual.findings.filter((finding) => finding.path === writer)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
    );
    expect(actual.findings.filter((finding) => finding.path === legacy)).toEqual([]);
    expect(
      actual.findings.filter((finding) => finding.path === composition && finding.blocking),
    ).toEqual([]);
  },
);

test("omitting the directory mapping retains canonical default layers", () => {
  const actual = inspect();
  expect(actual.requirements.map((row) => row.path).sort()).toEqual([
    "src/core/compositions/pure.ts",
    "src/core/legacy/value.ts",
    "src/core/readings/legacy-value.ts",
    "src/substrate/primitives/store.ts",
    "src/substrate/readings/write.ts",
  ]);
  expect(
    actual.findings.filter((finding) => finding.path === "src/substrate/readings/write.ts"),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test.each([
  { primitives: "reading", adapters: "adapters", readings: "reading", compositions: "effect" },
  { primitives: "state", adapters: "adapters", readings: "reading/extra", compositions: "effect" },
])("ambiguous or multi-directory layer names cannot establish placement", (layerNames) => {
  expect(inspect(layerNames).findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "R1",
        debtKey: "R1:layer-config:src",
        status: "unresolved",
        blocking: true,
        limit: expect.stringMatching(/\S/),
      }),
    ]),
  );
});
