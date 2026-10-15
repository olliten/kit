import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const root = mkdtempSync(join(tmpdir(), "kit-producer-invocation-"));
const description =
  "import type { WriteDescription } from '../../core/primitives/write-description.js';\n";
const producer = "import { produce } from '../../core/compositions/producer.js';\n";
const files: Record<string, string> = {
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
  "src/core/primitives/write-description.ts":
    "export interface WriteDescription { readonly key: string; readonly value: number; }\nexport interface OtherDescription { readonly other: boolean; }\n",
  "src/core/compositions/producer.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nexport function produce(key: string, value: number): WriteDescription { return { key, value }; }\n",
  "src/core/compositions/second-producer.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nexport function second(key: string, value: number): WriteDescription { return { key, value: value + 1 }; }\n",
  "src/core/compositions/other-producer.ts":
    "import type { OtherDescription } from '../primitives/write-description.js';\nexport function other(value: boolean): OtherDescription { return { other: value }; }\n",
  "src/core/compositions/cross-producer.ts":
    "import type { OtherDescription, WriteDescription } from '../primitives/write-description.js';\nimport { produce } from './producer.js';\nexport function cross(value: boolean): OtherDescription { return { other: value }; }\nexport function foreign(key: string, value: number): WriteDescription { void produce; return { key, value }; }\n",
  "src/core/compositions/producer-export.ts": "export { produce as make } from './producer.js';\n",
  "src/core/compositions/contract-producer.ts":
    "import type { WriteDescription as WriteData } from '../primitives/write-description.js';\nexport type WriteDescription = WriteData;\nexport function described(key: string, value: number): WriteDescription { return { key, value }; }\n",
  "src/core/readings/carried-data.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nexport function value(write: WriteDescription): number { return write.value; }\n",
  "src/core/compositions/function-producer.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nexport type WriteProducer = (key: string, value: number) => WriteDescription;\nexport function callbackProducer(key: string, value: number): WriteDescription { return { key, value }; }\n",
  "src/shell/compositions/function-invoke.ts":
    description +
    "import type { WriteProducer } from '../../core/compositions/function-producer.js';\nexport function invoke(operation: WriteProducer, key: string, value: number): WriteDescription { return operation(key, value); }\n",
  "src/core/compositions/unregistered.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nimport { produce } from './producer.js';\nexport function construct(key: string, value: number): WriteDescription { void produce; return { key, value }; }\n",
  "src/core/readings/invoke.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nimport { produce } from '../compositions/producer.js';\nexport function read(key: string, value: number): WriteDescription { return produce(key, value); }\n",
  "src/core/readings/construct.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nexport function read(key: string, value: number): WriteDescription { return { key, value }; }\n",
  "src/substrate/adapters/application.ts":
    description +
    "export function apply(write: WriteDescription, store: { [key: string]: number }): void { store[write.key] = write.value; }\n",
  "src/core/compositions/apply.ts":
    "import type { WriteDescription } from '../primitives/write-description.js';\nimport { apply } from '../../substrate/adapters/application.js';\nexport function commit(write: WriteDescription, store: { [key: string]: number }): void { apply(write, store); }\n",
  "src/substrate/compositions/apply.ts":
    description +
    "import { apply } from '../adapters/application.js';\nexport function commit(write: WriteDescription, store: { [key: string]: number }): void { apply(write, store); }\n",
};

for (const zone of ["shell", "substrate"] as const) {
  const base = `src/${zone}/compositions/`;
  files[base + "invoke.ts"] =
    description +
    producer +
    "export function run(key: string, value: number): WriteDescription { return produce(key, value); }\n";
  files[base + "alias.ts"] =
    description +
    "import { make as delegated } from '../../core/compositions/producer-export.js';\nexport function run(key: string, value: number): WriteDescription { return delegated(key, value); }\n";
  files[base + "construct.ts"] =
    description +
    producer +
    "export function run(key: string, value: number): WriteDescription { void produce; return { key, value }; }\n";
  files[base + "spread.ts"] =
    description +
    producer +
    "export function run(key: string, value: number): WriteDescription { return { ...produce(key, value) }; }\n";
  files[base + "inferred.ts"] =
    description +
    producer +
    "export function run(key: string, value: number): WriteDescription { const inferred = { ...produce(key, value) }; return inferred; }\n";
  files[base + "carry.ts"] =
    description +
    "export function carry(write: WriteDescription): WriteDescription { return write; }\nexport function record(write: WriteDescription): { readonly write: WriteDescription } { return { write }; }\nexport function list(write: WriteDescription): readonly WriteDescription[] { return [write]; }\n";
  files[`src/${zone}/readings/invoke.ts`] =
    description +
    producer +
    "export function read(key: string, value: number): WriteDescription { return produce(key, value); }\n";
}

const config: KitConfig = {
  ...DEFAULT_CONFIG,
  adapters: [
    ...[
      ["producer", "produce"],
      ["second-producer", "second"],
      ["other-producer", "other"],
      ["cross-producer", "cross"],
    ].map(([module, name]) => ({
      module: `core/compositions/${module}`,
      export: name ?? "",
      capability: "cell.produce",
      kind: "produce" as const,
      zones: ["core" as const],
    })),
    {
      module: "core/compositions/contract-producer",
      export: "described",
      capability: "cell.produce",
      kind: "produce",
      zones: ["core"],
      contract: { type: "WriteDescription" },
    },
    {
      module: "substrate/adapters/application",
      export: "apply",
      capability: "cell.apply",
      kind: "apply",
      zones: ["substrate"],
    },
    {
      module: "core/compositions/function-producer",
      export: "callbackProducer",
      capability: "cell.produce",
      kind: "produce",
      zones: ["core"],
      contract: { type: "WriteProducer" },
    },
  ],
};

let snapshot: ReturnType<typeof readSnapshot>;
try {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  snapshot = readSnapshot(root, config);
} finally {
  rmSync(root, { recursive: true, force: true });
}
const result = capabilityCheck(snapshot);
const findings = (path: string) => result.findings.filter((row) => row.path === path);
const clear = (path: string) =>
  expect(
    findings(path).filter((row) => row.blocking),
    path,
  ).toEqual([]);
const constructed = (path: string) =>
  expect(findings(path), path).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: "R2", status: "violation", blocking: true }),
    ]),
  );

test("the actual compiler accepts every fixture independently of policy findings", () => {
  expect(
    snapshot.compiler?.projects
      .flatMap((project) => project.diagnostics)
      .filter((row) => row.category === "error"),
  ).toEqual([]);
});
test("two declared Core producers of the same result each retain their own construction authority", () => {
  clear("src/core/compositions/producer.ts");
  clear("src/core/compositions/second-producer.ts");
});
test("a producer's zero-operation data contract grants no authority to a reading carrying its values", () => {
  const path = "src/core/readings/carried-data.ts";
  expect(result.requirements.find((row) => row.path === path)).toMatchObject({
    direct: [],
    inherited: [],
  });
  clear(path);
  clear("src/core/compositions/contract-producer.ts");
});
test("a callable producer contract retains authority despite having no method properties", () => {
  const path = "src/shell/compositions/function-invoke.ts";
  expect(result.requirements.find((row) => row.path === path)?.direct).toContain("cell.produce");
  clear(path);
});
test("registration does not authorize constructing another producer's result", () => {
  constructed("src/core/compositions/cross-producer.ts");
});
test("an unregistered Core importer cannot construct the result it can invoke", () => {
  constructed("src/core/compositions/unregistered.ts");
});

for (const zone of ["shell", "substrate"] as const) {
  test(`${zone} compositions invoke pure Core producers without gaining construction authority`, () => {
    const path = `src/${zone}/compositions/invoke.ts`;
    expect(result.requirements.find((row) => row.path === path)?.inherited).toContain(
      "cell.produce",
    );
    clear(path);
  });
  test(`${zone} invocation through an alias and re-export retains producer classification`, () => {
    const path = `src/${zone}/compositions/alias.ts`;
    expect(result.requirements.find((row) => row.path === path)?.inherited).toContain(
      "cell.produce",
    );
    clear(path);
  });
  test.each(["construct", "spread", "inferred"])(
    `${zone} rejects a visible %s construction`,
    (kind) => {
      constructed(`src/${zone}/compositions/${kind}.ts`);
    },
  );
  test(`${zone} carries existing descriptions directly, in records and in arrays without producing`, () => {
    const path = `src/${zone}/compositions/carry.ts`;
    expect(result.requirements.find((row) => row.path === path)?.inherited).toEqual([]);
    clear(path);
  });
  test(`${zone} readings cannot invoke a producer`, () => {
    expect(findings(`src/${zone}/readings/invoke.ts`)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "R1", status: "violation", blocking: true }),
      ]),
    );
  });
}
test("Core readings cannot invoke or visibly construct descriptions", () => {
  expect(findings("src/core/readings/invoke.ts")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: "R1", status: "violation", blocking: true }),
    ]),
  );
  constructed("src/core/readings/construct.ts");
});
test("write application remains permitted in substrate and forbidden in Core", () => {
  clear("src/substrate/compositions/apply.ts");
  expect(findings("src/core/compositions/apply.ts")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: "R1", status: "violation", blocking: true }),
    ]),
  );
});
