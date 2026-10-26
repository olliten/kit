import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { edgeCheck } from "../../src/core/readings/edge-check.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

// The fixture's import edges, what they carry, and what the import, edge and zone checks find in them; a
// fixture that doesn't compile throws.
function inspect(files: Readonly<Record<string, string>>, config: KitConfig = DEFAULT_CONFIG) {
  const snapshot = projectSnapshot(recordedImports(files, config), config);
  const context = capabilityContext(snapshot, []);
  const parts = [importAuthority(snapshot, context)];
  const edges = edgeCheck(snapshot, context);
  const graph = authorityGraph(snapshot, context, parts, edges.crossZoneFailures);
  return {
    requirements: [...graph.inherited].map(([path, capabilities]) => ({ path, inherited: [...capabilities].sort() })),
    findings: [
      ...parts.flatMap((part) => part.findings),
      ...edges.findings,
      ...zoneAuthorityCheck(snapshot, context, graph),
    ],
  };
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
