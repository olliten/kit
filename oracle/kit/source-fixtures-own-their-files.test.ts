import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { expect, test } from "vitest";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedContracts } from "../substrate/compositions/recorded-contracts.js";
import { recordedEscapes } from "../substrate/compositions/recorded-escapes.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";
import { recordedTerms } from "../substrate/compositions/recorded-terms.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

test("projects with the same prefix own separate files and can be disposed repeatedly", () => {
  const first = temporaryProjects.open("kit-project-isolation-");
  const second = temporaryProjects.open("kit-project-isolation-");
  try {
    expect(first.root).not.toBe(second.root);
    first.write({ "nested/value.ts": "export const value = 1;\n" });
    expect(readFileSync(join(first.root, "nested/value.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(existsSync(join(second.root, "nested/value.ts"))).toBe(false);
  } finally {
    first.dispose();
    second.dispose();
  }
  first.dispose();
  expect(existsSync(first.root)).toBe(false);
  expect(existsSync(second.root)).toBe(false);
});

test("a failed fixture write removes the partially written project", () => {
  let failure: unknown;
  try {
    sourceFixture({ blocked: "a file, not a directory", "blocked/value.ts": "export const value = 1;" });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ syscall: "mkdir" });
  const path =
    failure instanceof Error && "path" in failure && typeof failure.path === "string"
      ? failure.path
      : "";
  const root = dirname(path);
  expect(basename(root)).toMatch(/^kit-zone-boundary-/);
  expect(existsSync(root)).toBe(false);
});

test.each(["relative", "absolute"])("a %s path cannot write outside its project", (kind) => {
  const project = temporaryProjects.open("kit-project-boundary-");
  const outside = temporaryProjects.open("kit-project-neighbor-");
  try {
    outside.write({ "sentinel.txt": "unchanged" });
    const destination = join(outside.root, "sentinel.txt");
    const path = kind === "relative" ? relative(project.root, destination) : destination;
    expect(() => project.write({ [path]: "changed" })).toThrow(/inside the temporary project/);
    expect(readFileSync(destination, "utf8")).toBe("unchanged");
  } finally {
    project.dispose();
    outside.dispose();
  }
});

test.each(["relative", "absolute"])("new fixture operations keep %s paths inside their project", (kind) => {
  const project = temporaryProjects.open("kit-project-operations-");
  const outside = temporaryProjects.open("kit-project-untouched-");
  try {
    outside.write({ "sentinel.txt": "unchanged" });
    const destination = join(outside.root, "sentinel.txt");
    const path = kind === "relative" ? relative(project.root, destination) : destination;
    expect(() => project.directory(path)).toThrow(/inside the temporary project/);
    expect(() => project.remove(path)).toThrow(/inside the temporary project/);
    expect(() => project.symlink(path, "link")).toThrow(/inside the temporary project/);
    expect(() => project.symlink("inside", path)).toThrow(/inside the temporary project/);
    expect(() => project.remove(".")).toThrow(/inside the temporary project/);
    expect(readFileSync(destination, "utf8")).toBe("unchanged");
    expect(existsSync(join(project.root, "link"))).toBe(false);
    expect(existsSync(project.root)).toBe(true);
  } finally {
    project.dispose();
    outside.dispose();
  }
});

test("source fixtures preserve multiple code roots and compiler path mappings", () => {
  const snapshot = sourceFixture(
    {
      "app/core/primitives/value.ts": "export const value = 1;\n",
      "proof/core/readings/double.ts":
        "import { value } from '@value';\nexport const double: number = value * 2;\n",
    },
    { srcRoot: ["app", "proof"] },
    { paths: { "@value": ["./app/core/primitives/value.ts"] } },
  );
  expect(snapshot.config.srcRoot).toEqual(["app", "proof"]);
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  expect(snapshot.imports).toContainEqual(
    expect.objectContaining({
      from: "proof/core/readings/double.ts",
      to: "app/core/primitives/value.ts",
    }),
  );
});

test("a recorded fixture compiles its sources and records only what its recorder reads", () => {
  const facts = recordedContracts({
    "src/core/primitives/total.ts": "export interface Total { readonly value: number; }\n",
    "src/core/readings/total.test.ts": "export {};\n",
  });
  expect(facts.files).toEqual(["src/core/primitives/total.ts"]);
  expect(facts.contracts.map((contract) => contract.name)).toEqual(["Total"]);
  expect(facts.constructions).toEqual([]);
});

test("a fixture that doesn't compile is an error, so no proof reads facts from a broken program", () => {
  expect(() => recordedContracts({ "src/core/readings/broken.ts": "export const broken: number = 'text';\n" })).toThrow(
    /not assignable/,
  );
});

test("each recorded fixture records only its own recorder's facts", () => {
  const files = {
    "src/core/readings/value.ts":
      'import { other } from "./other.js";\nexport function value(input: string): number { return Date.now() + other + (input as unknown as number); }\n',
    "src/core/readings/other.ts": "export const other = 1;\n",
  };
  expect(recordedImports(files).imports.map((edge) => edge.target)).toEqual(["src/core/readings/other.ts"]);
  expect([...new Set(recordedAuthority(files).accesses.map((access) => access.kind))]).toEqual(["clock"]);
  expect(recordedEscapes(files).escapes.map((escape) => escape.kind)).toEqual(["assertion", "assertion"]);
  expect(recordedTerms(files).termFacts?.sources.map((source) => [source.file, source.factOnly])).toEqual([
    ["src/core/readings/other.ts", true],
    ["src/core/readings/value.ts", false],
  ]);
});
