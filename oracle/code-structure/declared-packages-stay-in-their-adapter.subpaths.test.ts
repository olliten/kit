import { expect, test } from "vitest";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";

const adapter = "src/substrate/adapters/runner.ts";
const proof = "oracle/runtime/proves.test.ts";

function permission(owner: readonly string[], imports: readonly { readonly file: string; readonly specifier: string; readonly names: readonly string[]; readonly typeOnly?: boolean }[]) {
  const snapshot = projectSnapshot({
    files: [...new Set([adapter, proof, ...imports.map(({ file }) => file)])],
    imports: imports.map(({ file, specifier, names, typeOnly }) => ({
      file, specifier, target: null, typeOnly: typeOnly ?? false, namedImports: names,
    })),
  }, {
    srcRoot: ["src", "oracle"],
    exceptions: [proof],
    packages: [{ name: "vitest", capabilities: ["test-runner"], entrypointExports: ["test"] }],
    adapters: [{ module: "src/substrate/adapters/runner", export: "runner", capability: "test-runner", kind: "external", zones: ["substrate"], packages: owner }],
  });
  return importAuthority(snapshot, capabilityContext(snapshot, [proof]));
}

test("owning vitest/node permits that adapter without claiming root test exports", () => {
  const result = permission(["vitest/node"], [
    { file: adapter, specifier: "vitest/node", names: ["parseCLI", "startVitest"] },
    { file: proof, specifier: "vitest", names: ["test"] },
  ]);
  expect(result.findings).toEqual([]);
  expect(result.grants).toEqual(expect.arrayContaining([
    { file: adapter, capability: "test-runner" }, { file: proof, capability: "test-runner" },
  ]));
});

test("the exact subpath stays private while root and sibling imports retain their existing public restrictions", () => {
  const outside = "src/substrate/compositions/outside.ts";
  const denied = permission(["vitest/node"], [{ file: outside, specifier: "vitest/node", names: ["startVitest"] }]);
  expect(denied.findings.map(({ debtKey }) => debtKey)).toContain(`R1:package-import:${outside}:vitest`);
  for (const specifier of ["vitest", "vitest/browser"]) {
    const result = permission(["vitest/node"], [{ file: outside, specifier, names: ["startVitest"] }]);
    expect(result.findings.some(({ debtKey }) => debtKey.includes(":package-import:"))).toBe(false);
    expect(result.findings.some(({ debtKey }) => debtKey.includes(":entrypoint-package:"))).toBe(true);
  }
});

test("an existing package-root owner still owns all its runtime subpaths", () => {
  for (const specifier of ["vitest", "vitest/node", "vitest/browser"]) {
    expect(permission(["vitest"], [{ file: adapter, specifier, names: ["test"] }]).findings).toEqual([]);
    expect(permission(["vitest"], [{ file: proof, specifier, names: ["test"] }]).findings.some(({ debtKey }) => debtKey.includes(":package-import:"))).toBe(true);
  }
});

test("a type-only subpath import grants no runtime authority", () => {
  const result = permission(["vitest/node"], [{ file: proof, specifier: "vitest/node", names: ["Vitest"], typeOnly: true }]);
  expect(result.findings).toEqual([]);
  expect(result.grants).toEqual([]);
});
