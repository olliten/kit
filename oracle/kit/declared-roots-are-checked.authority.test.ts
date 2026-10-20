import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../lib/source-fixture.js";

const clock: NonNullable<KitConfig["adapters"]>[number] = {
  module: "substrate/adapters/clock",
  export: "clock",
  capability: "clock.read",
  kind: "external",
  zones: ["substrate"],
  primitives: ["clock"],
};
const focus: NonNullable<KitConfig["adapters"]>[number] = {
  module: "substrate/adapters/focus",
  export: "focus",
  capability: "dom.focus",
  kind: "external",
  zones: ["substrate"],
  contract: { type: "Focus" },
};

function inspect(
  files: Readonly<Record<string, string>> = {},
  extra: NonNullable<KitConfig["adapters"]> = [],
) {
  const snapshot = sourceFixture(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          types: [],
          lib: ["ES2022", "DOM"],
          noEmit: true,
        },
        include: ["src/**/*.ts", "oracle/**/*.ts"],
      }),
      "src/core/compositions/run.ts":
        "export function run(read: () => number): number { return read(); }\n",
      "oracle/core/compositions/run.ts":
        "export function run(read: () => number): number { return read(); }\n",
      "oracle/core/readings/model.ts": "export function model(): number { return 7; }\n",
      "oracle/substrate/adapters/clock.ts":
        "export function clock(): number { return Date.now(); }\n",
      "src/substrate/compositions/probe.ts":
        "import { model } from '../../../oracle/core/readings/model.js';\nexport const value: number = model();\n",
      ...files,
    },
    {
      srcRoot: ["src", "oracle"],
      adapters: [clock, ...extra].map((row) => ({ ...row, module: `oracle/${row.module}` })),
    },
  );
  expect(snapshot.compiler?.projects).toHaveLength(1);
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return snapshot;
}

const base = inspect();

test("an empty or sparse root set cannot produce an empty authority graph", () => {
  for (const srcRoot of [[], Array<string>(1)]) {
    expect(() => capabilityCheck({ ...base, config: { ...base.config, srcRoot, adapters: [] } })).toThrow(/code roots/);
  }
});

test("a qualified legacy contract keeps its declared zone without acquiring a layer", () => {
  const store: NonNullable<KitConfig["adapters"]>[number] = {
    module: "old/state/store", export: "put", capability: "cell.apply",
    kind: "apply", zones: ["substrate"], contract: { type: "Writer" },
  };
  const snapshot = inspect({
    "oracle/old/state/store.ts": "export interface Writer { put(value: number): void; }\nexport function put(writer: Writer, value: number): void { writer.put(value); }\n",
    "src/substrate/compositions/probe.ts": "import { put, type Writer } from '../../../oracle/old/state/store.js';\nexport function probe(writer: Writer): void { put(writer, 7); }\n",
  }, [store]);
  expect(capabilityCheck({ ...snapshot, config: { ...snapshot.config,
    legacyZones: [{ root: "oracle/old", zone: "substrate" }] } }).findings).toEqual([]);
});

test("one authority graph admits pure cross-root calls and registered adapters regardless of root order", () => {
  const snapshot = base;
  const result = capabilityCheck(snapshot);
  expect(result.findings).toEqual([]);
  expect(result.requirements.map((row) => row.path)).toEqual(
    snapshot.files.filter((file) => file.type === "source").map((file) => file.path),
  );
  expect(
    capabilityCheck({ ...snapshot, config: { ...snapshot.config, srcRoot: ["oracle", "src"] } }),
  ).toEqual(result);
});

test.each([
  ["src", "oracle"],
  ["oracle", "src"],
])("a clock closure from %s cannot enter the core in %s", (caller, target) => {
  const snapshot = inspect({
    [`${caller}/substrate/compositions/probe.ts`]:
      `import { run } from '../../../${target}/core/compositions/run.js';\n` +
      `import { clock } from '../../../oracle/substrate/adapters/clock.js';\n` +
      "export const value: number = run(() => clock());\n",
  });
  expect(capabilityCheck(snapshot).findings).toContainEqual(
    expect.objectContaining({
      status: "violation",
      blocking: true,
      debtKey: expect.stringContaining(":closure-binding:"),
    }),
  );
});

test("a reading cannot acquire authority through another root", () => {
  const snapshot = inspect({
    "src/core/readings/bad.ts":
      "import { clock } from '../../../oracle/substrate/adapters/clock.js';\nexport const value: number = clock();\n",
  });
  expect(capabilityCheck(snapshot).findings).toContainEqual(
    expect.objectContaining({
      path: "src/core/readings/bad.ts",
      debtKey: "R1:reading-authority:src/core/readings/bad.ts:clock.read",
    }),
  );
});

test("a root set requires canonical qualified adapter identities instead of choosing a default root", () => {
  for (const module of [clock.module, "oracle/substrate/adapters/clock/extra"]) {
    expect(() => capabilityCheck({ ...base, config: { ...base.config, adapters: [{ ...clock, module }] } })).toThrow(/module identity/);
  }
});

const focusSource =
  "export interface Focus { act(element: HTMLElement): void; }\nexport const focus: Focus = { act(element) { element.focus(); } };\n";

test("a native handle can reach its permitted adapter in another root", () => {
  const snapshot = inspect(
    {
      "oracle/substrate/adapters/focus.ts": focusSource,
      "src/substrate/compositions/probe.ts":
        "import { focus } from '../../../oracle/substrate/adapters/focus.js';\nexport function probe(element: HTMLElement): void { focus.act(element); }\n",
    },
    [focus],
  );
  expect(capabilityCheck(snapshot).findings).toEqual([]);
});

test("a native handle captured across roots cannot enter a core callback", () => {
  const snapshot = inspect(
    {
      "oracle/substrate/adapters/focus.ts": focusSource,
      "src/substrate/compositions/probe.ts":
        "import { run } from '../../../oracle/core/compositions/run.js';\nexport function probe(element: HTMLElement): number { return run(() => { element.focus(); return 7; }); }\n",
    },
    [focus],
  );
  expect(
    capabilityCheck(snapshot).findings.some(
      (item) => item.blocking && /native-authority|closure-binding/.test(item.debtKey),
    ),
  ).toBe(true);
});
