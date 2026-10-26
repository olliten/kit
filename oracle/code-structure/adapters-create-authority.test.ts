import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { fakeClock } from "../../fixture/adapter-contracts/fake-clock.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

function inspect(extra: Readonly<Record<string, string>>, configChange?: Partial<KitConfig>) {
  const root = mkdtempSync(join(tmpdir(), "kit-adapter-contract-"));
  const config: KitConfig = {
    ...DEFAULT_CONFIG,
    adapters: [
      {
        module: "substrate/adapters/clock",
        export: "clock",
        capability: "clock.read",
        kind: "external",
        zones: ["substrate"],
        contract: { type: "Clock" },
        primitives: ["clock"],
      },
      {
        module: "shell/adapters/render",
        export: "title",
        capability: "dom.render",
        kind: "external",
        zones: ["shell"],
        globals: ["document"],
      },
    ],
    ...configChange,
  };
  const inputs = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM"],
        types: [],
        strict: true,
        noEmit: true,
        declaration: true,
        isolatedDeclarations: true,
      },
      include: ["src/**/*.ts"],
    }),
    "src/substrate/adapters/clock.ts":
      "export interface Clock { now(): number; sample(): number; }\n" +
      "export const clock: Clock = { now: () => Date.now(), sample: () => Date.now() };\n",
    "src/shell/adapters/render.ts": "export function title(): string { return document.title; }\n",
    ...extra,
  };
  try {
    for (const [path, content] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const snapshot = readSnapshot(root, config);
    return { snapshot, result: capabilityCheck(snapshot) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("executing the fake does not load the real implementation beside its interface", () => {
  expect(fakeClock.now()).toBe(7);
  expect(fakeClock.sample()).toBe(7);
});

test("a registered DOM adapter may use its configured raw primitive", () => {
  const { result } = inspect({});
  expect(result.findings.filter((row) => row.path === "src/shell/adapters/render.ts")).toEqual([]);
});

test("one registered adapter owns a multi-operation contract and its implementation", () => {
  const { snapshot, result } = inspect({});
  const contract = snapshot.compiler?.projects
    .flatMap((project) => project.contracts)
    .find((row) => row.file === "src/substrate/adapters/clock.ts" && row.name === "Clock");
  expect(contract?.operations.slice().sort()).toEqual(["now", "sample"]);
  expect(
    result.requirements.find((row) => row.path === "src/substrate/adapters/clock.ts")?.direct,
  ).toEqual(["clock.read"]);
  expect(result.findings.filter((row) => row.path === "src/substrate/adapters/clock.ts")).toEqual(
    [],
  );
});

test("a fake built outside its adapter reaches no authority, but constructing the contract there is a finding", () => {
  const path = "src/substrate/compositions/fake-clock.ts";
  const { snapshot, result } = inspect({
    [path]:
      "import type { Clock } from '../adapters/clock.js';\n" +
      "export const fakeClock: Clock = { now: () => 7, sample: () => 7 };\n",
  });
  expect(snapshot.compiler?.projects.flatMap((project) => project.imports)).toEqual(
    expect.arrayContaining([expect.objectContaining({ file: path, typeOnly: true })]),
  );
  expect(result.requirements.find((row) => row.path === path)).toMatchObject({
    direct: [],
    inherited: [],
  });
  expect(result.findings.filter((row) => row.path === path).map((row) => row.debtKey)).toEqual([
    `R1:contract-construction:${path}:Clock`,
  ]);
});

test("a composition receiving the registered interface gains its capability", () => {
  const path = "src/substrate/compositions/sample.ts";
  const { result } = inspect({
    [path]:
      "import type { Clock } from '../adapters/clock.js';\n" +
      "export function sample(clock: Clock): number { return clock.now(); }\n",
  });
  expect(result.requirements.find((row) => row.path === path)?.direct).toEqual(["clock.read"]);
  expect(result.findings.filter((row) => row.path === path)).toEqual([]);
});

test("a reading cannot import even the type-only capability contract", () => {
  const path = "src/substrate/readings/sample.ts";
  const { snapshot, result } = inspect({
    [path]:
      "import type { Clock } from '../adapters/clock.js';\n" +
      "export function sample(clock: Clock): number { return clock.now(); }\n",
  });
  expect(dependencyCheck(snapshot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: "R2", path: "substrate/readings/sample" }),
    ]),
  );
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:reading-authority:${path}:clock.read`,
        blocking: true,
      }),
    ]),
  );
});

test("runtime reexports retain the adapter capability transitively", () => {
  const path = "src/core/compositions/run.ts";
  const { result } = inspect({
    "src/substrate/compositions/clock-export.ts": "export { clock } from '../adapters/clock.js';\n",
    [path]:
      "import { clock } from '../../substrate/compositions/clock-export.js';\nexport function run(): number { return clock.now(); }\n",
  });
  expect(result.requirements.find((row) => row.path === path)?.inherited).toEqual(["clock.read"]);
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: `R1:zone-authority:${path}:clock.read`, blocking: true }),
    ]),
  );
});

test("a misspelled canonical contract is a finding, never an assumed-pure boundary", () => {
  const { result } = inspect(
    {},
    {
      adapters: [
        {
          module: "substrate/adapters/clock",
          export: "clock",
          capability: "clock.read",
          kind: "external",
          zones: ["substrate"],
          contract: { type: "MissingClock" },
          primitives: ["clock"],
        },
      ],
    },
  );
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining("R1:adapter-contract:"),
        blocking: true,
      }),
    ]),
  );
});

test("core cannot host an external adapter even when configuration grants its zone", () => {
  const path = "src/core/adapters/clock.ts";
  const { result } = inspect(
    { [path]: "export function clock(): number { return Date.now(); }\n" },
    {
      adapters: [
        {
          module: "core/adapters/clock",
          export: "clock",
          capability: "clock.read",
          kind: "external",
          zones: ["core"],
          primitives: ["clock"],
        },
      ],
    },
  );
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test.each(["adapters", "compositions"])(
  "unregistered raw clock access in %s remains a finding",
  (layer) => {
    const path = `src/substrate/${layer}/unregistered.ts`;
    const { result } = inspect({
      [path]: "export function sample(): number { return Date.now(); }\n",
    });
    expect(result.findings.filter((row) => row.path === path)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: expect.stringContaining("R1:raw-primitive:"),
          blocking: true,
        }),
      ]),
    );
  },
);

test.each(["adapters", "compositions"])(
  "unregistered DOM access in %s remains a finding",
  (layer) => {
    const path = `src/shell/${layer}/unregistered.ts`;
    const { result } = inspect({
      [path]: "export function title(): string { return document.title; }\n",
    });
    expect(result.findings.filter((row) => row.path === path)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: expect.stringContaining("R1:raw-primitive:"),
          blocking: true,
        }),
      ]),
    );
  },
);
