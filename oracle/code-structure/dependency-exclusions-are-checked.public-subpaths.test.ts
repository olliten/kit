import { expect, test } from "vitest";
import { dependencyExclusions } from "../../src/core/readings/dependency-exclusions.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";

const origin = "src/substrate/compositions/read.ts";
const forbidden = "oracle/core/readings/reference.ts";
const contract = { name: "example-sdk/public", capabilities: ["sdk"] };

function inspect(specifier: string, reach: "direct" | "transitive", contracts = [contract]) {
  return dependencyExclusions(projectSnapshot({
    files: [origin, forbidden],
    imports: [{ file: origin, specifier, target: null, typeOnly: false, namedImports: ["read"] }],
  }, {
    srcRoot: ["src", "oracle"], packages: contracts,
    dependencyExclusions: [{ from: origin, to: forbidden, imports: "runtime", reach }],
  }));
}

test.each(["example-sdk/public", "@supplier/example-sdk/public"])("direct exclusions accept the declared exact external boundary %s", (name) => {
  expect(inspect(name, "direct", [{ ...contract, name }])).toEqual({ findings: [], limits: [] });
});

test.each(["example-sdk", "example-sdk/sibling", "example-sdk/public/internal"])("an exact public contract cannot classify the direct boundary %s", (specifier) => {
  const result = inspect(specifier, "direct");
  expect(result.findings).toEqual([]);
  expect(result.limits).toContainEqual(expect.objectContaining({
    debtKey: `R2:dependency-boundary:${origin}:${origin}:${specifier}`,
  }));
});

test("a classified exact subpath cannot establish transitive separation", () => {
  const result = inspect(contract.name, "transitive");
  expect(result.findings).toEqual([]);
  expect(result.limits).toContainEqual(expect.objectContaining({
    debtKey: `R2:dependency-boundary:${origin}:${origin}:${contract.name}`,
  }));
});

test("the existing package-root contract still classifies direct sibling boundaries", () => {
  expect(inspect("example-sdk/sibling", "direct", [{ ...contract, name: "example-sdk" }]))
    .toEqual({ findings: [], limits: [] });
});

test("an exact package row cannot hide its declaration home in the forbidden root", () => {
  const result = dependencyExclusions(projectSnapshot({
    files: [origin, forbidden],
    imports: [{ file: origin, specifier: contract.name, target: null,
      declarationTarget: forbidden, typeOnly: false, namedImports: ["read"] }],
  }, {
    srcRoot: ["src", "oracle"], packages: [contract],
    dependencyExclusions: [{ from: origin, to: forbidden, imports: "all", reach: "direct" }],
  }));
  expect(result.limits).toEqual([]);
  expect(result.findings).toContainEqual(expect.objectContaining({
    debtKey: `R2:dependency-exclusion:${origin}:all:direct:${forbidden}`,
  }));
});
