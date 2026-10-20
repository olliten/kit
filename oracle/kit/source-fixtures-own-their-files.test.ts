import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { expect, test } from "vitest";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
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
