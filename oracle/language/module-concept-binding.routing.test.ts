import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const engine = fileURLToPath(new URL("../../..", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(source: string, terms: string, baseline: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "kit-concept-routing-"));
  roots.push(root);
  const files = {
    "src/core/readings/read.ts": source,
    "spec/terms.md": terms,
    "spec/language.md": "# Language\n\n### core/readings/read\nThe supplied reading.\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: [],
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
    "package.json": JSON.stringify({ type: "module" }),
    "kit-config.md":
      "```yaml\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nlegacy-areas: []\nadapters: []\npackages: []\n```\n",
    "baseline.json": JSON.stringify(baseline),
  };
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const args = [
    join(engine, "scripts/kit-check.mjs"),
    `--root=${root}`,
    `--config=${join(root, "kit-config.md")}`,
    `--baseline=${join(root, "baseline.json")}`,
  ];
  return { args, root };
}

test("the real gate refuses an unbound placed concept even when its key is forged into baseline", () => {
  const { args } = fixture(
    "export function read(): boolean { return true; }\n",
    "- **read** — A meaning-only vocabulary entry.\n",
    { "R3:term-module:src/core/readings/read.ts:missing-owner": {} },
  );
  const result = spawnSync("node", args, { cwd: engine, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("R3:term-module:src/core/readings/read.ts:missing-owner");
});

test("term metadata acceptance does not erase an unknown runtime package boundary", () => {
  const { args } = fixture(
    "import { consume } from 'unknown-package';\nexport function read(value: string): string { return consume(value); }\n",
    "- **read** — The entire concept.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
  );
  const report = spawnSync("node", [...args, "--report"], { cwd: engine, encoding: "utf8" });
  expect(report.error).toBeUndefined();
  expect(report.status).toBe(0);
  const findings = JSON.parse(report.stdout).findings;
  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: "R1:external-boundary:src/core/readings/read.ts:unknown-package",
        status: "unresolved",
        blocking: true,
      }),
    ]),
  );
  expect(
    findings.some(
      (finding: { debtKey: string }) =>
        finding.debtKey.includes(":term-module:") || finding.debtKey.includes(":term-source:"),
    ),
  ).toBe(false);
  const checked = spawnSync("node", args, { cwd: engine, encoding: "utf8" });
  expect(checked.error).toBeUndefined();
  expect(checked.status).toBe(1);
  expect(checked.stderr).toContain(
    "R1:external-boundary:src/core/readings/read.ts:unknown-package",
  );
});
