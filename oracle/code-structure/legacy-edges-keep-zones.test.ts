import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

function inspect(files: Readonly<Record<string, string>>, config: KitConfig = DEFAULT_CONFIG) {
  const root = mkdtempSync(join(tmpdir(), "kit-migration-edge-"));
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
          isolatedDeclarations: true,
          declaration: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return capabilityCheck(readSnapshot(root, config));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("migration edges use actual zones and transitive capabilities", () => {
  test("legacy Core cannot import a placed Shell module even when the Shell export is pure", () => {
    const path = "src/core/legacy/run.ts";
    const result = inspect({
      [path]:
        "import { label } from '../../shell/readings/label.js';\nexport function run(): string { return label(); }\n",
      "src/shell/readings/label.ts": "export function label(): string { return 'label'; }\n",
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, status: "violation", blocking: true }),
      ]),
    );
  });

  test("legacy Core can call a placed pure Core reading without inventing a legacy layer", () => {
    const result = inspect({
      "src/core/legacy/run.ts":
        "import { offset } from '../readings/offset.js';\nexport function run(value: number): number { return offset(value); }\n",
      "src/core/readings/offset.ts":
        "export function offset(value: number): number { return value + 1; }\n",
    });
    expect(result.findings).toEqual([]);
  });

  test("a placed reading cannot launder write production through a legacy re-export", () => {
    const path = "src/core/readings/value.ts";
    const result = inspect(
      {
        "src/core/compositions/save-value.ts":
          "export interface WriteSet { readonly value: number; }\nexport function save(value: number): WriteSet { return { value }; }\n",
        "src/core/legacy/save.ts": "export { save } from '../compositions/save-value.js';\n",
        [path]:
          "import { save } from '../legacy/save.js';\nexport function value(input: number): number { return save(input).value; }\n",
      },
      {
        ...DEFAULT_CONFIG,
        adapters: [
          {
            module: "core/compositions/save-value",
            export: "save",
            capability: "value.produce",
            kind: "produce",
            zones: ["core"],
          },
        ],
      },
    );
    expect(result.requirements.find((row) => row.path === path)?.inherited).toContain(
      "value.produce",
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, status: "violation", blocking: true }),
      ]),
    );
  });
});
