import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { startupCheck } from "../../src/core/readings/startup-check.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

type Packages = NonNullable<KitConfig["packages"]>;
const proof = "oracle/runtime/proves.test.ts";
const adapter = "src/substrate/adapters/reader.ts";
const helper = "src/substrate/compositions/helper.ts";
const core = "src/core/readings/value.ts";
const exact = { name: "example-sdk/public", capabilities: ["sdk"] };
const root = { name: "example-sdk", capabilities: ["root-sdk"] };

// Import facts are the check's public input; the compiler fixture below separately establishes
// original named aliases and erased imports. No package-name selection is reproduced in this proof.
function inspect(
  specifier: string,
  packages: Packages = [exact],
  options: {
    readonly file?: string;
    readonly names?: readonly string[] | null;
    readonly missingNames?: boolean;
    readonly typeOnly?: boolean;
    readonly owner?: readonly string[];
  } = {},
) {
  const file = options.file ?? helper;
  const snapshot = projectSnapshot({
    files: [proof, adapter, helper, core],
    imports: [{
      file, specifier, target: null, typeOnly: options.typeOnly ?? false,
      ...(options.missingNames ? {} : { namedImports: options.names === undefined ? ["read"] : options.names }),
    }],
  }, {
    srcRoot: ["src", "oracle"], exceptions: [proof], packages,
    adapters: [{
      module: "src/substrate/adapters/reader", export: "reader", capability: "sdk",
      kind: "external", zones: ["substrate"], packages: options.owner ?? [],
    }],
  });
  const startup = startupCheck(snapshot);
  const context = capabilityContext(snapshot, startup.startups);
  const authority = importAuthority(snapshot, context);
  const graph = authorityGraph(snapshot, context, [authority], new Set());
  return { authority, findings: [...authority.findings, ...zoneAuthorityCheck(snapshot, context, graph)] };
}

test.each(["example-sdk/public", "@supplier/example-sdk/public", "node:fs/promises"])("an exact public contract classifies %s alone", (name) => {
  const result = inspect(name, [{ ...exact, name }]);
  expect(result.findings).toEqual([]);
  expect(result.authority.grants).toEqual([{ file: helper, capability: "sdk" }]);
});

test.each([
  "example-sdk", "example-sdk/sibling", "example-sdk/public/internal",
  "example-sdk/publicity", "example-sdk/public/", "example-sdk/public?mode=test",
  "@supplier/example-sdk", "@supplier/example-sdk/sibling", "@supplier/example-sdk/public/internal",
])("a declared exact subpath grants no contract to %s", (specifier) => {
  const result = inspect(specifier, [exact, { ...exact, name: "@supplier/example-sdk/public" }]);
  expect(result.authority.grants).toEqual([]);
  expect(result.authority.findings).toEqual([
    expect.objectContaining({ debtKey: `R1:external-boundary:${helper}:${specifier}`, blocking: true }),
  ]);
});

test.each([{ packages: [root, exact] }, { packages: [exact, root] }])("exact contracts win independently of declaration order: %j", ({ packages }) => {
  expect(inspect(exact.name, packages).authority.grants).toEqual([{ file: helper, capability: "sdk" }]);
  for (const specifier of [root.name, "example-sdk/sibling", "example-sdk/public/internal"])
    expect(inspect(specifier, packages).authority.grants).toEqual([{ file: helper, capability: "root-sdk" }]);
});

test("an explicitly narrower pure exact contract does not inherit the root's capabilities", () => {
  const result = inspect(exact.name, [root, { ...exact, capabilities: [] }], { file: core });
  expect(result.authority.grants).toEqual([]);
  expect(result.findings).toEqual([]);
});

test.each([{ owner: ["example-sdk"] }, { owner: ["example-sdk/public"] }])("adapter ownership %j wins over an exact global purity row", ({ owner }) => {
  const packages = [{ ...exact, capabilities: [] }];
  expect(inspect(exact.name, packages, { file: adapter, owner }).authority.grants)
    .toEqual([{ file: adapter, capability: "sdk" }]);
  const outside = inspect(exact.name, packages, { owner });
  expect(outside.authority.findings).toContainEqual(
    expect.objectContaining({ debtKey: `R1:package-import:${helper}:example-sdk`, blocking: true }),
  );
  expect(outside.authority.grants).toEqual([{ file: helper, capability: "sdk" }]);
});

test("an effectful exact contract still cannot enter a Core reading", () => {
  const result = inspect(exact.name, [exact], { file: core });
  expect(result.authority.grants).toEqual([{ file: core, capability: "sdk" }]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({ debtKey: `R1:reading-authority:${core}:sdk`, blocking: true }),
  );
});

test("type-only imports acquire neither exact nor adapter-owned authority", () => {
  const result = inspect(exact.name, [exact], { typeOnly: true, owner: [root.name] });
  expect(result.authority.grants).toEqual([]);
  expect(result.findings).toEqual([]);
});

test.each(["./local.js", "#local"])("a global row cannot classify the unresolved local import %s", (specifier) => {
  const result = inspect(specifier, [{ ...exact, name: specifier }]);
  expect(result.authority.grants).toEqual([]);
  expect(result.authority.findings).toContainEqual(
    expect.objectContaining({ debtKey: `R1:external-boundary:${helper}:${specifier}`, blocking: true }),
  );
});

const restricted = { ...exact, entrypointExports: ["read"] };
test("restricted exact contracts permit only their named runtime export at a proof entrypoint", () => {
  expect(inspect(exact.name, [restricted], { file: proof }).findings).toEqual([]);
  const denied = [
    inspect(exact.name, [restricted]),
    inspect(exact.name, [restricted], { file: proof, names: ["write"] }),
    inspect(exact.name, [restricted], { file: proof, names: [] }),
    inspect(exact.name, [restricted], { file: proof, names: null }),
    inspect(exact.name, [restricted], { file: proof, missingNames: true }),
  ];
  for (const result of denied) {
    expect(result.authority.grants).toEqual([]);
    expect(result.authority.findings).toContainEqual(
      expect.objectContaining({ debtKey: expect.stringContaining(":entrypoint-package:"), blocking: true }),
    );
  }
});

test("a restricted root fallback still refuses undeclared subpaths", () => {
  const result = inspect("example-sdk/sibling", [{ ...root, entrypointExports: ["read"] }], { file: proof });
  expect(result.authority.grants).toEqual([]);
  expect(result.authority.findings).toContainEqual(
    expect.objectContaining({ debtKey: `R1:entrypoint-package:${proof}:example-sdk/sibling`, blocking: true }),
  );
});

test("actual compiler evidence retains named aliases and erases type-only public imports", () => {
  const config = { srcRoot: ["src", "oracle"], packages: [restricted], exceptions: [proof] };
  const imports = recordedImports({
    [proof]: "import { read as value, type Input } from 'example-sdk/public';\nexport function result(input: Input): number { return value(input); }",
    "src/sdk.d.ts": "declare module 'example-sdk/public' { export interface Input { readonly n: number; } export function read(input: Input): number; }",
  }, config);
  const snapshot = projectSnapshot(imports, config);
  expect(imports.imports).toContainEqual(expect.objectContaining({ specifier: exact.name, namedImports: ["read"], typeOnly: false }));
  const context = capabilityContext(snapshot, startupCheck(snapshot).startups);
  expect(importAuthority(snapshot, context).findings).toEqual([]);
  expect(importAuthority(snapshot, context).grants).toEqual([{ file: proof, capability: "sdk" }]);
});
