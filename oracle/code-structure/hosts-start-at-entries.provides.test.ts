import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";
import { configuredHosts } from "../../scripts/kit-config.mjs";

const proof = "oracle/count/increments.test.ts";
const contract = { name: "vitest", capabilities: ["test-runner"] };
const proofHost = (exports: readonly string[]): NonNullable<KitConfig["hosts"]> => ({
  proof: { lib: ["dom", "node"], entries: [proof], provides: { vitest: exports } },
});
const source =
  "import { test, expect } from 'vitest'; test('increments', () => { expect(1 + 1).toBe(2); });\n";

function inspect(
  code = source,
  files: Readonly<Record<string, string>> = {},
  config: Partial<KitConfig> = {},
) {
  const snapshot = sourceFixture(
    {
      "package.json": JSON.stringify({ type: "module" }),
      [proof]: code,
      ...files,
    },
    { srcRoot: ["src", "oracle"], hosts: proofHost(["test", "expect"]), packages: [contract], ...config },
    {
      skipLibCheck: true,
      paths: {
        vitest: [
          fileURLToPath(new URL("../../node_modules/vitest/dist/index.d.ts", import.meta.url)),
        ],
      },
    },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return { snapshot, result: capabilityCheck(snapshot) };
}

test("real Vitest registration and assertions are exports the proof host provides", () => {
  const { result } = inspect();
  expect(result.findings).toEqual([]);
  expect(result.requirements.find((row) => row.path === proof)?.direct).toEqual(["test-runner"]);
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
  expect(result.requirements.find((row) => row.path === proof)?.direct).toEqual([]);
});

test("hook registration uses the same explicit effectful boundary", () => {
  const { result } = inspect(
    "import { beforeEach, afterEach, test, expect } from 'vitest'; let n = 0; beforeEach(() => { n = 1; }); afterEach(() => { n = 0; }); test('value', () => { expect(n).toBe(1); });\n",
    {},
    {
      hosts: proofHost(["test", "expect", "beforeEach", "afterEach"]),
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
          hosts: proofHost(["test", "beforeEach"]),
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

test("a helper cannot import a provided package on the proof's behalf", () => {
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

test.each([
  { body: "return 7;", blocked: false },
  { body: "expect(1).toBe(1); return 7;", blocked: true },
])("callbacks keep runner authority when supplied to core: $blocked", ({ body, blocked }) => {
  const core = "src/core/compositions/run.ts";
  const { result } = inspect(
    "import { test, expect } from 'vitest';\nimport { run } from '../../src/core/compositions/run.js';\n" +
      `test('case', () => { run(() => { ${body} }); });\n`,
    {
      [core]: "export function run(action: () => number): number { return action(); }\n",
    },
  );
  if (!blocked) expect(result.findings).toEqual([]);
  else
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        path: core,
        debtKey: expect.stringContaining(`R1:closure-binding:${core}:${proof}:`),
        blocking: true,
      }),
    );
});

test("a package owned by an adapter remains unavailable to direct entry imports", () => {
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

test("provided exports reject subpaths, absent compiler evidence and malformed declarations", () => {
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
    expect(capabilityCheck({ ...snapshot, compiler }).findings).toContainEqual(
      expect.objectContaining({
        path: proof,
        debtKey: expect.stringContaining(`R1:entrypoint-package:${proof}:vitest`),
        blocking: true,
      }),
    );
  }
  for (const provides of [
    { vitest: [] },
    { vitest: [""] },
    { vitest: ["*"] },
    { "./local": ["test"] },
  ])
    expect(() => configuredHosts({ proof: { lib: ["node"], provides } })).toThrow(/provides/);
});
