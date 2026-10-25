import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const engine = fileURLToPath(new URL("../..", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const legacy = "src/legacy/report.ts";
const key = `R1:legacy-size:${legacy}`;
const report = (extra: string): string =>
  "export function report(values: readonly number[]): number {\n" +
  extra +
  "  return values.length;\n" +
  "}\n";

function app(source: string, baseline: unknown) {
  const root = mkdtempSync(join(tmpdir(), "kit-legacy-size-"));
  roots.push(root);
  const files: Record<string, string> = {
    [legacy]: source,
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
    "spec/terms.md": "# Terms\n",
    "baseline.json": JSON.stringify(baseline),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const run = (...extra: string[]) =>
    spawnSync(
      "node",
      [
        join(engine, "scripts/kit-check.mjs"),
        `--root=${root}`,
        `--config=${join(root, "kit-config.md")}`,
        `--baseline=${join(root, "baseline.json")}`,
        ...extra,
      ],
      { cwd: engine, encoding: "utf8" },
    );
  const recorded = () => JSON.parse(readFileSync(join(root, "baseline.json"), "utf8"));
  return { run, recorded };
}

test("the real gate fails a legacy module grown past its recorded size, and --tighten records a shrink", () => {
  const own = "  const doubled = values.length * 2;\n  void doubled;\n";
  const grown = app(report(own), { [key]: { statements: 2, calls: 0 } });
  const failed = grown.run();
  expect(failed.error).toBeUndefined();
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain(`${key}: This legacy module has 4 statements of its own; its baseline records 2.`);

  const shrunk = app(report(""), { [key]: { statements: 4, calls: 0, note: "kept" }, "R1:gone:x": {} });
  const passed = shrunk.run("--tighten");
  expect(passed.error).toBeUndefined();
  expect(passed.stderr).toBe("");
  expect(passed.status).toBe(0);
  expect(shrunk.recorded()).toEqual({ [key]: { statements: 2, calls: 0, note: "kept" } });
});
