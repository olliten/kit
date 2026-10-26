import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { dependencyExclusions } from "../../src/core/readings/dependency-exclusions.js";
import { fixtureFiles } from "../core/readings/fixture-files.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

const actual = "src/core/readings/actual.ts";
const model = "oracle/core/readings/reference.ts";
const relay = "oracle/core/readings/relay.ts";
const policy = { from: model, to: actual, imports: "runtime", reach: "transitive" } as const;
const files = {
  [actual]:
    "export interface Data { readonly n: number; }\nexport function actual(n: number): number { return n + 1; }\n",
  [model]:
    "export interface Data { readonly n: number; }\nexport function reference(n: number): number { return n + 1; }\n",
  [relay]: "export function relay(n: number): number { return n + 1; }\n",
};

// The compiled fixture's imports in a snapshot of them alone; a fixture that doesn't compile throws.
function importSnapshot(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig>,
  options: Parameters<typeof fixtureFiles>[2] = {},
) {
  return projectSnapshot(recordedImports(fixtureFiles(files, config, options), config), config);
}

function inspect(
  extra: Readonly<Record<string, string>> = {},
  rules: NonNullable<KitConfig["dependencyExclusions"]> = [policy],
  options: Parameters<typeof fixtureFiles>[2] = {},
) {
  const snapshot = importSnapshot(
    { "package.json": JSON.stringify({ type: "module" }), ...files, ...extra },
    {
      srcRoot: ["src", "oracle"],
      dependencyExclusions: rules,
    },
    options,
  );
  return { snapshot, result: dependencyExclusions(snapshot) };
}

test("an independent model and a reused independent helper pass", () => {
  const { result } = inspect({
    [model]:
      "import { relay } from './relay.js'; export function reference(n: number): number { return relay(n); }\n",
  });
  expect(result).toEqual({ findings: [], limits: [] });
});

test.each(["runtime", "type"])("a direct root boundary rejects %s imports", (kind) => {
  const code =
    kind === "runtime"
      ? "import { reference } from '../../../oracle/core/readings/reference.js'; export function actual(n: number): number { return reference(n); }\n"
      : "import type { Data } from '../../../oracle/core/readings/reference.js'; export function actual(n: number): number { const data: Data = { n }; return data.n; }\n";
  const { result } = inspect({ [actual]: code }, [
    { from: "src/", to: "oracle/", imports: "all", reach: "direct" },
  ]);
  expect(result.limits).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path: actual,
      debtKey: `R2:dependency-exclusion:${actual}:all:direct:${model}`,
    }),
  );
});

test.each(["direct", "alias", "helper", "re-export"])(
  "runtime model dependence is rejected through a %s",
  (kind) => {
    const extra =
      kind === "direct"
        ? {
            [model]:
              "import { actual } from '../../../src/core/readings/actual.js'; export function reference(n: number): number { return actual(n); }\n",
          }
        : kind === "alias"
          ? {
              [model]:
                "import { actual } from '#actual'; export function reference(n: number): number { return actual(n); }\n",
            }
          : {
              [model]:
                "import { relay } from './relay.js'; export function reference(n: number): number { return relay(n); }\n",
              [relay]:
                kind === "helper"
                  ? "import { actual } from '../../../src/core/readings/actual.js'; export function relay(n: number): number { return actual(n); }\n"
                  : "export { actual as relay } from '../../../src/core/readings/actual.js';\n",
            };
    const { result } = inspect(extra, [policy], {
      paths: { "#actual": ["./src/core/readings/actual.ts"] },
    });
    expect(result.limits).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        path: model,
        debtKey: `R2:dependency-exclusion:${model}:runtime:transitive:${actual}`,
      }),
    );
    if (kind === "helper" || kind === "re-export") expect(result.findings[0]?.fix).toContain(relay);
  },
);

test("runtime separation permits erased contracts, including through a helper", () => {
  const { result } = inspect({
    [model]:
      "import { relay } from './relay.js'; export function reference(n: number): number { return relay(n); }\n",
    [relay]:
      "import type { Data } from '../../../src/core/readings/actual.js'; export function relay(n: number): number { const data: Data = { n }; return data.n + 1; }\n",
  });
  expect(result.findings).toEqual([]);
  expect(result.limits).toEqual([]);
});

test("direct and transitive separation have explicit, different scope", () => {
  const { result } = inspect(
    {
      [model]:
        "import { relay } from './relay.js'; export function reference(n: number): number { return relay(n); }\n",
      [relay]: "export { actual as relay } from '../../../src/core/readings/actual.js';\n",
    },
    [{ ...policy, reach: "direct" }],
  );
  expect(result.findings).toEqual([]);
  expect(result.limits).toEqual([]);
});

test("direct import direction can use a classified external package boundary", () => {
  const { snapshot } = inspect(
    {
      [actual]:
        "import { read } from 'opaque-sdk'; export function actual(n: number): number { return read(n); }\n",
      "src/sdk.d.ts": "declare module 'opaque-sdk' { export function read(n: number): number; }\n",
    },
    [{ from: "src", to: "oracle", imports: "all", reach: "direct" }],
  );
  const result = dependencyExclusions({
    ...snapshot,
    config: { ...snapshot.config, packages: [{ name: "opaque-sdk", capabilities: [] }] },
  });
  expect(result).toEqual({ findings: [], limits: [] });
});

test("direct direction uses ambient module declarations without claiming runtime purity", () => {
  const { snapshot, result } = inspect(
    {
      [actual]: "import { read } from 'node:fs'; export function actual(n: number): number { return read(n); }\n",
      "src/sdk.d.ts": "declare module 'node:fs' { export function read(n: number): number; }\n",
    },
    [{ from: "src", to: "oracle", imports: "all", reach: "direct" }],
  );
  expect(result).toEqual({ findings: [], limits: [] });
  const transitive = dependencyExclusions({
    ...snapshot,
    config: {
      ...snapshot.config,
      dependencyExclusions: [{ from: actual, to: model, imports: "runtime", reach: "transitive" }],
    },
  });
  expect(transitive.limits).toContainEqual(expect.objectContaining({ path: actual }));
});

test("an ambient declaration in the forbidden root is still a direct dependency", () => {
  const { result } = inspect(
    {
      [actual]: "import { read } from 'node:fs'; export function actual(n: number): number { return read(n); }\n",
      "oracle/sdk.d.ts": "declare module 'node:fs' { export function read(n: number): number; }\n",
    },
    [{ from: "src", to: "oracle", imports: "all", reach: "direct" }],
  );
  expect(result.findings).toContainEqual(expect.objectContaining({
    debtKey: `R2:dependency-exclusion:${actual}:all:direct:oracle/sdk.d.ts`,
  }));
});

test("ambient declarations with multiple homes retain explicit boundary uncertainty", () => {
  const { result } = inspect(
    {
      [actual]: "import { read } from 'node:fs'; export function actual(n: number): number { return read(n); }\n",
      "src/sdk.d.ts": "declare module 'node:fs' { export function read(n: number): number; }\n",
      "oracle/sdk.d.ts": "declare module 'node:fs' { export interface Metadata { readonly size: number; } }\n",
    },
    [{ from: "src", to: "oracle", imports: "all", reach: "direct" }],
  );
  expect(result.limits).toContainEqual(expect.objectContaining({ path: actual }));
});

test("a model's opaque external dependency remains a limit even with a package purity declaration", () => {
  const { snapshot } = inspect();
  const next = importSnapshot(
    {
      ...files,
      "package.json": JSON.stringify({ type: "module" }),
      [model]:
        "import { expect } from 'vitest'; export function reference(n: number): number { expect(n).toBe(n); return n + 1; }\n",
    },
    { ...snapshot.config, packages: [{ name: "vitest", capabilities: [] }] },
    {
      skipLibCheck: true,
      paths: {
        vitest: [
          fileURLToPath(new URL("../../node_modules/vitest/dist/index.d.ts", import.meta.url)),
        ],
      },
    },
  );
  const result = dependencyExclusions(next);
  expect(result.findings).toEqual([]);
  expect(result.limits).toContainEqual(
    expect.objectContaining({
      path: model,
      debtKey: expect.stringContaining(`R2:dependency-boundary:${model}:`),
    }),
  );
});

test("missing compiler coverage and an undeclared test helper cannot prove separation", () => {
  const { snapshot } = inspect();
  const result = dependencyExclusions({ ...snapshot, compiler: { version: "none", projects: [] } });
  expect(result.limits).toContainEqual(
    expect.objectContaining({ path: model, debtKey: `R2:dependency-boundary:${model}:${model}` }),
  );
  const helper = "oracle/count/helper.test.ts";
  const other = inspect({
    [model]:
      "import { value } from '../../count/helper.test.js'; export function reference(n: number): number { return n + value; }\n",
    [helper]: "export const value: number = 1;\n",
  });
  expect(other.result.limits).toContainEqual(
    expect.objectContaining({ path: model, debtKey: `R2:dependency-boundary:${model}:${helper}` }),
  );
});

test("unmatched and noncanonical selectors cannot silently disable a rule", () => {
  const { snapshot } = inspect();
  for (const from of ["missing", "../oracle", "oracle/*", "/oracle", "oracle//core"]) {
    expect(() =>
      dependencyExclusions({
        ...snapshot,
        config: { ...snapshot.config, dependencyExclusions: [{ ...policy, from }] },
      }),
    ).toThrow();
  }
  expect(() =>
    dependencyExclusions({
      ...snapshot,
      config: { ...snapshot.config, dependencyExclusions: [{ ...policy, to: "missing" }] },
    }),
  ).toThrow();
});
