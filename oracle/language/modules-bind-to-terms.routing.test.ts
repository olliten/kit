import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const engine = fileURLToPath(new URL("../..", import.meta.url));
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

function fixture(source: string, terms: string, baseline: Record<string, unknown> = {}) {
  const project = temporaryProjects.open("kit-concept-routing-");
  projects.push(project);
  const root = project.root;
  project.write({
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
  });
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
  const result = processes.run(processes.node(), args, engine);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("R3:term-module:src/core/readings/read.ts:missing-owner");
});

test("term metadata acceptance does not erase an unknown runtime package boundary", () => {
  const { args } = fixture(
    "import { consume } from 'unknown-package';\nexport function read(value: string): string { return consume(value); }\n",
    "- **read** — The entire concept.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
  );
  const report = processes.run(processes.node(), [...args, "--report"], engine);
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
  const checked = processes.run(processes.node(), args, engine);
  expect(checked.status).toBe(1);
  expect(checked.stderr).toContain(
    "R1:external-boundary:src/core/readings/read.ts:unknown-package",
  );
});
