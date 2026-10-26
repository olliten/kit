import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const environment = "src/substrate/adapters/environment.ts";
const diagnostic = "src/substrate/adapters/diagnostic.ts";
const environmentSource =
  "export interface Environment { directory(): string; }\n" +
  "export const environment: Environment = { directory: () => process.cwd() };\n";
const diagnosticSource =
  "export interface Diagnostic { write(text: string): void; }\n" +
  "export const diagnostic: Diagnostic = { write: (text) => { process.stderr.write(text); } };\n";
const owners: NonNullable<KitConfig["adapters"]> = [
  {
    module: "substrate/adapters/environment",
    export: "environment",
    capability: "environment.read",
    kind: "external",
    zones: ["substrate"],
    contract: { type: "Environment" },
    globals: ["process"],
  },
  {
    module: "substrate/adapters/diagnostic",
    export: "diagnostic",
    capability: "diagnostic.write",
    kind: "external",
    zones: ["substrate"],
    contract: { type: "Diagnostic" },
    globals: ["process"],
  },
];

function inspect(
  files: Readonly<Record<string, string>> = {},
  adapters: NonNullable<KitConfig["adapters"]> = owners,
) {
  const snapshot = sourceFixture(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          types: ["node"],
          typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      "package.json": JSON.stringify({ type: "module" }),
      [environment]: environmentSource,
      [diagnostic]: diagnosticSource,
      ...files,
    },
    { adapters },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot);
}

test.each([false, true])(
  "two adapters sharing process retain only their own capability, reversed=%s",
  (reversed) => {
    const result = inspect({}, reversed ? [...owners].reverse() : owners);
    expect(result.requirements.find((row) => row.path === environment)).toEqual({
      path: environment,
      direct: ["environment.read"],
      inherited: ["environment.read"],
    });
    expect(result.requirements.find((row) => row.path === diagnostic)).toEqual({
      path: diagnostic,
      direct: ["diagnostic.write"],
      inherited: ["diagnostic.write"],
    });
    expect(result.findings).toEqual([]);
  },
);

test("multiple registered exports in one owner do not reject that owner's global", () => {
  const result = inspect(
    {
      [environment]:
        environmentSource +
        "export const fallbackEnvironment: Environment = { directory: () => process.cwd() };\n",
    },
    [
      ...owners,
      {
        module: "substrate/adapters/environment",
        export: "fallbackEnvironment",
        capability: "environment.fallback",
        kind: "external",
        zones: ["substrate"],
        contract: { type: "Environment" },
        globals: ["process"],
      },
    ],
  );
  expect(result.requirements.find((row) => row.path === environment)).toEqual({
    path: environment,
    direct: ["environment.fallback", "environment.read"],
    inherited: ["environment.fallback", "environment.read"],
  });
  expect(result.requirements.find((row) => row.path === diagnostic)).toEqual({
    path: diagnostic,
    direct: ["diagnostic.write"],
    inherited: ["diagnostic.write"],
  });
  expect(result.findings).toEqual([]);
});

test("a substrate composition receiving one plain contract gains only that capability", () => {
  const path = "src/substrate/compositions/directory.ts";
  const result = inspect({
    [path]:
      "import type { Environment } from '../adapters/environment.js';\n" +
      "export function directory(environment: Environment): string { return environment.directory(); }\n",
  });
  expect(result.requirements.find((row) => row.path === path)).toEqual({
    path,
    direct: ["environment.read"],
    inherited: ["environment.read"],
  });
  expect(result.findings).toEqual([]);
});

test.each(["adapters", "compositions"])(
  "a process declaration by other owners does not authorize raw access in %s",
  (layer) => {
    const path = `src/substrate/${layer}/unregistered.ts`;
    const result = inspect(
      { [path]: "export function directory(): string { return process.cwd(); }\n" },
      layer === "adapters"
        ? [
            ...owners,
            {
              module: "substrate/adapters/unregistered",
              export: "directory",
              capability: "unregistered.read",
              kind: "external",
              zones: ["substrate"],
            },
          ]
        : owners,
    );
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

test.each([
  ["core/compositions", "zone-authority"],
  ["substrate/readings", "reading-authority"],
])("the environment contract stays confined outside %s", (location, finding) => {
  const path = `src/${location}/directory.ts`;
  const imported = location.startsWith("core") ? "../../substrate" : "..";
  const result = inspect({
    [path]:
      `import type { Environment } from '${imported}/adapters/environment.js';\n` +
      "export function directory(environment: Environment): string { return environment.directory(); }\n",
  });
  expect(result.requirements.find((row) => row.path === path)?.direct).toEqual([
    "environment.read",
  ]);
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:${finding}:${path}:environment.read`,
        blocking: true,
      }),
    ]),
  );
});

test("a runtime reexport keeps only its owner's capability and cannot enter core", () => {
  const path = "src/core/compositions/directory.ts";
  const result = inspect({
    "src/substrate/compositions/environment-export.ts":
      "export { environment } from '../adapters/environment.js';\n",
    [path]:
      "import { environment } from '../../substrate/compositions/environment-export.js';\n" +
      "export function directory(): string { return environment.directory(); }\n",
  });
  expect(result.requirements.find((row) => row.path === path)?.inherited).toEqual([
    "environment.read",
  ]);
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:zone-authority:${path}:environment.read`,
        blocking: true,
      }),
    ]),
  );
});

test.each([false, true])(
  "sharing process never lets an environment callback enter core, relay=%s",
  (relay) => {
    const result = inspect({
      "src/core/compositions/run.ts":
        "export function run(read: () => string): string { return read(); }\n",
      ...(relay
        ? {
            "src/substrate/compositions/relay.ts":
              "import { run } from '../../core/compositions/run.js';\n" +
              "export function relay(read: () => string): string { return run(read); }\n",
          }
        : {}),
      "src/substrate/compositions/probe.ts":
        "import { environment } from '../adapters/environment.js';\n" +
        (relay
          ? "import { relay } from './relay.js';\n"
          : "import { run } from '../../core/compositions/run.js';\n") +
        `export const result: string = ${relay ? "relay" : "run"}(() => environment.directory());\n`,
    });
    expect(result.findings.map((row) => row.debtKey)).toContain(
      "R1:takes-behaviour:src/core/compositions/run.ts:run",
    );
  },
);
