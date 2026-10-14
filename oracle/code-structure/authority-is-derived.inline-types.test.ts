import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

test.each([
  [
    "inline type import",
    "import { type Clock } from '../adapters/clock.js'; export type SavedClock = Clock;",
    true,
  ],
  ["inline type reexport", "export { type Clock } from '../adapters/clock.js';", true],
  [
    "mixed import",
    "import { clock, type Clock } from '../adapters/clock.js'; export const saved: Clock = clock;",
    false,
  ],
  ["empty import", "import {} from '../adapters/clock.js'; export const value: number = 7;", false],
] as const)("%s preserves its declared runtime authority boundary", (_name, syntax, typeOnly) => {
  const root = mkdtempSync(join(tmpdir(), "kit-inline-types-"));
  const path = "src/substrate/compositions/value.ts";
  try {
    const inputs = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          types: [],
          strict: true,
          noEmit: true,
          declaration: true,
          isolatedDeclarations: true,
        },
        include: ["src/**/*.ts"],
      }),
      "src/substrate/adapters/clock.ts":
        "export interface Clock { now(): number; }\nexport const clock: Clock = { now: () => Date.now() };\n",
      [path]: `${syntax}\n`,
    };
    for (const [file, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const snapshot = readSnapshot(root, {
      ...DEFAULT_CONFIG,
      adapters: [
        {
          module: "substrate/adapters/clock",
          export: "clock",
          capability: "clock.read",
          kind: "external",
          zones: ["substrate"],
          contract: { type: "Clock" },
          primitives: ["clock"],
        },
      ],
    });
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    expect(
      snapshot.compiler?.projects
        .flatMap((project) => project.imports)
        .filter((edge) => edge.file === path),
    ).toEqual([
      expect.objectContaining({ file: path, target: "src/substrate/adapters/clock.ts", typeOnly }),
    ]);
    const result = capabilityCheck(snapshot);
    expect(result.requirements.find((row) => row.path === path)?.inherited).toEqual(
      typeOnly ? [] : ["clock.read"],
    );
    expect(result.findings).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
