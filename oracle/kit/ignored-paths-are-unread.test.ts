import { afterEach, expect, test } from "vitest";
import type { CompilerRead } from "../../src/substrate/adapters/compiler.js";
import type { FilesystemRead } from "../../src/substrate/adapters/filesystem.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { SMALL_APP, SMALL_IGNORE } from "../core/primitives/small-app.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

import { configuredKit, kitConfig } from "../../src/core/compositions/kit-configuration.js";

const CONFIG: KitConfig = { ...DEFAULT_CONFIG, ignore: SMALL_IGNORE };
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});
const app = (files: Readonly<Record<string, string>>): string => {
  const project = temporaryProjects.open("kit-ignore-");
  projects.push(project);
  project.write(files);
  return project.root;
};

test("an ignored path is neither a snapshot file nor listed nor read", () => {
  const root = app(SMALL_APP);
  const trace: { filesystem: FilesystemRead[]; compiler: CompilerRead[] } = { filesystem: [], compiler: [] };
  const snapshot = readSnapshot(root, CONFIG, trace);
  expect(snapshot.files.map((file) => file.path)).not.toContain("evidence/read-cost/1.json");
  expect(snapshot.files.map((file) => file.path)).toContain("src/core/primitives/value.ts");
  expect(trace.filesystem.filter((read) => read.arguments[0].includes("/evidence"))).toEqual([]);
});

test.each([
  ["a relative import", "../../../evidence/thing.js"],
  ["an import through a path alias", "@evidence/thing.js"],
])("%s into an ignored path is an error, not a missing edge", (_, specifier) => {
  const root = app({
    ...SMALL_APP,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        paths: { "@evidence/*": ["./evidence/*"] },
      },
      include: ["src/**/*.ts"],
    }),
    "evidence/thing.ts": "export const thing = 1;\n",
    "src/core/readings/uses-evidence.ts": `import { thing } from "${specifier}";\nexport const used = thing;\n`,
  });
  expect(() => readSnapshot(root, CONFIG)).toThrow(
    /src\/core\/readings\/uses-evidence\.ts imports evidence\/thing\.(?:js|ts), which the config ignores/,
  );
});

const declared = (yaml: string) =>
  configuredKit(
    CONFIG,
    kitConfig(
      "```yaml\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\n" +
        yaml +
        "\n```\n",
    ),
  );

test("the config declares ignored paths as one path or a list of relative paths", () => {
  expect(declared("ignore: evidence/").ignore).toEqual(["evidence"]);
  expect(declared("ignore: [evidence/, generated/out]").ignore).toEqual(["evidence", "generated/out"]);
  expect(declared("").ignore).toEqual([]);
  for (const path of ["../outside", "/absolute", "evidence/*.json", "."])
    expect(() => declared(`ignore: ["${path}"]`)).toThrow(/relative path inside the app/);
});
