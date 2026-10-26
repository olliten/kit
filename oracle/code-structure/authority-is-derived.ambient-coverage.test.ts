import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/compositions/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const ambient = "src/probe.d.ts";

test.each([true, false])(
  "ambient declaration coverage follows the actual configured project: included=%s",
  (included) => {
    const root = mkdtempSync(join(tmpdir(), "kit-ambient-coverage-"));
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
            declaration: true,
            isolatedDeclarations: true,
            noEmit: true,
          },
          files: ["src/core/primitives/value.ts", ...(included ? [ambient] : [])],
        }),
        "src/core/primitives/value.ts": "export interface Value { readonly text: string }\n",
        [ambient]:
          'declare module "probe-external" { export interface Probe { readonly text: string } }\n',
      };
      for (const [path, text] of Object.entries(inputs)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      const snapshot = readSnapshot(root, DEFAULT_CONFIG);
      expect(snapshot.files).toContainEqual(expect.objectContaining({ path: ambient, type: "source" }));
      expect(snapshot.compiler?.projects).toHaveLength(1);
      const project = snapshot.compiler?.projects[0];
      expect(project?.diagnostics).toEqual([]);
      expect(project?.files).toContain("src/core/primitives/value.ts");
      expect(project?.files).not.toContain(ambient);
      expect(project?.ambientFiles.includes(ambient)).toBe(included);
      const coverage = capabilityCheck(snapshot).findings.filter(
        (finding) => finding.debtKey === `R1:compiler-boundary:${ambient}`,
      );
      expect(coverage).toEqual(
        included
          ? []
          : [
              expect.objectContaining({
                path: ambient,
                status: "unresolved",
                blocking: true,
                category: "checker-limit",
                limit: "The source is excluded from every compiler project.",
              }),
            ],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
