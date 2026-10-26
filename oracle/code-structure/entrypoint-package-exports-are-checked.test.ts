import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { behaviourCheck } from "../../src/core/readings/behaviour-check.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { startupCheck } from "../../src/core/readings/startup-check.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { fixtureFiles } from "../core/readings/fixture-files.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

// The declared entrypoint: a claim proof that registers its cases.
const proof = "oracle/count/increments.test.ts";
const contract = {
  name: "vitest",
  capabilities: ["test-runner"],
  entrypointExports: ["test", "expect"],
};
const source =
  "import { test, expect } from 'vitest'; test('increments', () => { expect(1 + 1).toBe(2); });\n";

// Which declared exceptions are entrypoints, what each module holds, the zone rules over it and the behaviour
// the core may not take. No fixture has legacy code between zones, so no edge crosses placement.
function check(snapshot: Snapshot) {
  const { startups, findings } = startupCheck(snapshot);
  const context = capabilityContext(snapshot, startups);
  const parts = [accessAuthority(snapshot, context), globalAuthority(snapshot, context), importAuthority(snapshot, context)];
  const graph = authorityGraph(snapshot, context, parts, new Set());
  return {
    direct: (path: string) => [...(graph.direct.get(path) ?? [])].sort(),
    findings: [
      ...findings,
      ...parts.flatMap((part) => part.findings),
      ...zoneAuthorityCheck(snapshot, context, graph),
      ...behaviourCheck(snapshot),
    ],
  };
}

// A fixture that doesn't compile throws.
function inspect(
  code = source,
  files: Readonly<Record<string, string>> = {},
  config: Partial<KitConfig> = {},
) {
  const settings: Partial<KitConfig> = { srcRoot: ["src", "oracle"], exceptions: [proof], packages: [contract], ...config };
  const sources = fixtureFiles(
    {
      "package.json": JSON.stringify({ type: "module" }),
      [proof]: code,
      ...files,
    },
    settings,
    {
      skipLibCheck: true,
      paths: {
        vitest: [
          fileURLToPath(new URL("../../node_modules/vitest/dist/index.d.ts", import.meta.url)),
        ],
      },
    },
  );
  const snapshot = projectSnapshot(
    { ...recordedAuthority(sources, settings), ...recordedImports(sources, settings) },
    settings,
  );
  return { snapshot, result: check(snapshot) };
}

test("real Vitest registration and assertions are an effectful entrypoint contract", () => {
  const { result } = inspect();
  expect(result.findings).toEqual([]);
  expect(result.direct(proof)).toEqual(["test-runner"]);
});

test("named aliases and erased imports retain their original runtime export names", () => {
  const { result, snapshot } = inspect(
    "import { test as check, expect as verify, type VitestUtils } from 'vitest'; type Tools = VitestUtils; check('increments', () => { verify(2).toBe(2); });\n",
  );
  expect(result.findings).toEqual([]);
  expect(snapshot.compiler?.projects.flatMap((project) => project.imports)).toContainEqual(
    expect.objectContaining({
      file: proof,
      specifier: "vitest",
      namedImports: ["test", "expect"],
      typeOnly: false,
    }),
  );
});

test.each([
  "import { vi } from 'vitest'; void vi;\n",
  "import * as runner from 'vitest'; runner.test('case', () => {});\n",
  "import 'vitest';\n",
  "void import('vitest');\n",
  "export { test } from 'vitest';\n",
])("unsupported runtime package access stays a limit: %s", (code) => {
  expect(inspect(code).result.findings).toContainEqual(
    expect.objectContaining({
      path: proof,
      debtKey: `R1:entrypoint-package:${proof}:vitest`,
      category: "checker-limit",
      blocking: true,
    }),
  );
});

test("type-only imports do not acquire the runner's authority", () => {
  const { result } = inspect(
    "import type { VitestUtils } from 'vitest'; type Tools = VitestUtils;\n",
  );
  expect(result.findings).toEqual([]);
  expect(result.direct(proof)).toEqual([]);
});

test("hook registration uses the same explicit effectful boundary", () => {
  const { result } = inspect(
    "import { beforeEach, afterEach, test, expect } from 'vitest'; let n = 0; beforeEach(() => { n = 1; }); afterEach(() => { n = 0; }); test('value', () => { expect(n).toBe(1); });\n",
    {},
    {
      packages: [
        {
          ...contract,
          entrypointExports: [...contract.entrypointExports, "beforeEach", "afterEach"],
        },
      ],
    },
  );
  expect(result.findings).toEqual([]);
});

test.each(["test", "beforeEach"])(
  "registration does not suppress raw effects in a %s callback",
  (name) => {
    const invoke =
      name === "test"
        ? "test('clock', () => { Date.now(); });"
        : "beforeEach(() => { Date.now(); });";
    expect(
      inspect(
        `import { ${name} } from 'vitest'; ${invoke}\n`,
        {},
        {
          packages: [{ ...contract, entrypointExports: ["test", "beforeEach"] }],
        },
      ).result.findings,
    ).toContainEqual(
      expect.objectContaining({
        path: proof,
        debtKey: `R1:raw-primitive:${proof}:clock`,
        category: "placed-violation",
        blocking: true,
      }),
    );
  },
);

test("a helper cannot import the entrypoint package on the proof's behalf", () => {
  const helper = "oracle/substrate/compositions/register.ts";
  const { result } = inspect(
    "import { register } from '../substrate/compositions/register.js'; register();\n",
    {
      [helper]:
        "import { test } from 'vitest'; export function register(): void { test('case', () => {}); }\n",
    },
  );
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path: helper,
      debtKey: `R1:entrypoint-package:${helper}:vitest`,
      blocking: true,
    }),
  );
});

test.each(["return 7;", "expect(1).toBe(1); return 7;"])(
  "core takes no callback, whatever an entrypoint hands it: %s",
  (body) => {
    const core = "src/core/compositions/run.ts";
    const { result } = inspect(
      "import { test, expect } from 'vitest';\nimport { run } from '../../src/core/compositions/run.js';\n" +
        `test('case', () => { run(() => { ${body} }); });\n`,
      {
        [core]: "export function run(action: () => number): number { return action(); }\n",
      },
    );
    expect(result.findings.map((item) => item.debtKey)).toEqual([`R1:takes-behaviour:${core}:run`]);
  },
);

test("a package owned by an adapter remains unavailable to direct entrypoint imports", () => {
  const { result } = inspect(
    source,
    {
      "oracle/substrate/adapters/register.ts": "export function register(): void {}\n",
    },
    {
      adapters: [
        {
          module: "oracle/substrate/adapters/register",
          export: "register",
          capability: "test-runner",
          kind: "external",
          zones: ["substrate"],
          packages: ["vitest"],
        },
      ],
    },
  );
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path: proof,
      debtKey: `R1:package-import:${proof}:vitest`,
      blocking: true,
    }),
  );
});

test("restricted contracts reject subpaths, absent compiler evidence and malformed declarations", () => {
  const { snapshot } = inspect();
  for (const kind of ["subpath", "missing-evidence"]) {
    const compiler = {
      version: snapshot.compiler?.version ?? "missing",
      projects: (snapshot.compiler?.projects ?? []).map((project) => ({
        ...project,
        imports: project.imports.map(({ file, specifier, target, typeOnly, namedImports }) =>
          kind === "subpath"
            ? {
                file,
                specifier: `${specifier}/subpath`,
                target,
                typeOnly,
                namedImports: namedImports ?? null,
              }
            : { file, specifier, target, typeOnly },
        ),
      })),
    };
    expect(check({ ...snapshot, compiler }).findings).toContainEqual(
      expect.objectContaining({
        path: proof,
        debtKey: expect.stringContaining(`R1:entrypoint-package:${proof}:vitest`),
        blocking: true,
      }),
    );
  }
  for (const packages of [
    [{ ...contract, capabilities: [] }],
    [{ ...contract, capabilities: new Array<string>(1) }],
    [{ ...contract, entrypointExports: [] }],
    [{ ...contract, entrypointExports: new Array<string>(1) }],
    [{ ...contract, entrypointExports: ["*"] }],
    [{ ...contract, entrypointExports: ["test", "test"] }],
    [contract, { name: "vitest", capabilities: [] }],
  ])
    expect(() =>
      check({ ...snapshot, config: { ...snapshot.config, packages } }),
    ).toThrow(/entrypoint package contract/);
});
