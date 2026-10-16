import { afterEach, expect, test } from "vitest";
import type { CompilerRead } from "../../src/substrate/adapters/compiler.js";
import type { FilesystemRead } from "../../src/substrate/adapters/filesystem.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { CACHE_APP, CACHE_CONFIG, removeCacheApps, scratch, writeApp } from "../lib/cache-fixture.js";

const { configuredKit, kitConfig } = await import(
  new URL("../../scripts/kit-config.mjs", import.meta.url).href
);

afterEach(removeCacheApps);

test("an ignored path is neither a snapshot file nor listed nor read", () => {
  const root = scratch("kit-ignore-");
  writeApp(root, CACHE_APP);
  const trace = { filesystem: [] as FilesystemRead[], compiler: [] as CompilerRead[] };
  const snapshot = readSnapshot(root, CACHE_CONFIG, trace);
  expect(snapshot.files.map((file) => file.path)).not.toContain("evidence/read-cost/1.json");
  expect(snapshot.files.map((file) => file.path)).toContain("src/core/primitives/value.ts");
  expect(trace.filesystem.filter((read) => read.arguments[0].includes("/evidence"))).toEqual([]);
});

test.each([
  ["a relative import", "../../../evidence/thing.js"],
  ["an import through a path alias", "@evidence/thing.js"],
])("%s into an ignored path is an error, not a missing edge", (_, specifier) => {
  const root = scratch("kit-ignore-");
  writeApp(root, {
    ...CACHE_APP,
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
  expect(() => readSnapshot(root, CACHE_CONFIG)).toThrow(
    /src\/core\/readings\/uses-evidence\.ts imports evidence\/thing\.(?:js|ts), which the config ignores/,
  );
});

const declared = (yaml: string) =>
  configuredKit(
    CACHE_CONFIG,
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
