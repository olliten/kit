import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { removeCacheApps, scratch, writeApp } from "../lib/cache-fixture.js";

afterEach(removeCacheApps);

const engine = resolve(import.meta.dirname, "../..");

test("metadata errors stop together before compilation without caching a partial snapshot", () => {
  const base = scratch("kit-metadata-first-");
  const app = join(base, "app");
  const observed = join(base, "compiler-reads.txt");
  const preload = join(base, "observe-compiler.cjs");
  const topic = "# Count\n\nNumbers.\n\n## Reading\n\n- A value is read ({{value}}). · {#reads}\n";
  const source = "export function value(): number { return Date.now(); }\n";
  writeApp(app, {
    "package.json": '{"type":"module"}',
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        types: [],
        lib: ["ES2022"],
        noEmit: true,
      },
      include: ["src/**/*.ts", "oracle/**/*.ts"],
    }),
    "kit/config.md":
      "```yaml\napp: numbers\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\n```\n",
    "kit/debt/legacy.json": "{}",
    "spec/terms.md":
      "# Terms\n\n- **value** — the reading.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
    "spec/count.md": topic + "\nUnattached prose.\n",
    "src/core/readings/value.ts": "// spec/count.md\n" + source,
    "src/legacy.ts": "export function oldClock(): number { return Date.now(); }\n",
  });
  mkdirSync(join(app, ".git"));
  // Observation lives outside the app so it cannot change an input during extraction or checking.
  writeFileSync(
    preload,
    `const fs = require('node:fs');
const ts = require(${JSON.stringify(join(engine, "node_modules/typescript"))});
const original = ts.sys.readFile;
ts.sys.readFile = function (path, ...args) {
  if (path === ${JSON.stringify(join(app, "tsconfig.json"))})
    fs.appendFileSync(${JSON.stringify(observed)}, 'compiler read\\n');
  return original.call(this, path, ...args);
};
`,
  );
  const run = (flags: readonly string[] = []) => {
    rmSync(observed, { force: true });
    return spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        join(engine, "scripts/kit-check.mjs"),
        "--root=.",
        "--config=kit/config.md",
        "--baseline=kit/debt/legacy.json",
        ...flags,
      ],
      { cwd: app, encoding: "utf8", timeout: 120_000 },
    );
  };
  const cacheIndex = join(app, ".git/kit-cache/index.json");
  const blocked = run();
  expect(blocked.status, blocked.stdout + blocked.stderr).toBe(1);
  expect(blocked.stderr).toContain("R4:topic-shape:");
  expect(blocked.stderr).toContain("R3:missing-proof:");
  expect(blocked.stderr).toContain("R3:comment-citation:");
  expect(existsSync(observed), "the real compiler adapter never read the app project").toBe(false);
  expect(existsSync(cacheIndex), "metadata alone is not a cacheable semantic snapshot").toBe(false);
  expect(readFileSync(join(app, "kit/debt/legacy.json"), "utf8")).toBe("{}");

  const report = run(["--report"]);
  expect(report.status, report.stderr).toBe(0);
  expect(existsSync(observed), "report explicitly requests semantic findings too").toBe(true);
  const inventory = JSON.parse(report.stdout) as {
    findings: { debtKey: string; category: string; statements?: number; calls?: number }[];
    receipt: { reused: boolean };
  };
  expect(inventory.receipt.reused).toBe(false);
  const keys = inventory.findings.map((item) => item.debtKey);
  expect(keys.some((key) => key.startsWith("R4:topic-shape:"))).toBe(true);
  expect(keys.some((key) => key.startsWith("R3:missing-proof:"))).toBe(true);
  expect(keys.some((key) => key.startsWith("R3:comment-citation:"))).toBe(true);
  expect(keys).toContain("R1:raw-primitive:src/core/readings/value.ts:clock");
  expect(existsSync(cacheIndex)).toBe(true);

  const warm = run(["--report"]);
  expect(warm.status, warm.stderr).toBe(0);
  const warmReport = JSON.parse(warm.stdout) as typeof inventory;
  expect(warmReport.receipt.reused).toBe(true);
  expect(warmReport.findings).toEqual(inventory.findings);

  const legacy = Object.fromEntries(
    inventory.findings
      .filter((item) => item.category === "legacy-debt")
      .map((item) => [
        item.debtKey,
        typeof item.statements === "number"
          ? { statements: item.statements, calls: item.calls }
          : null,
      ]),
  );
  expect(Object.keys(legacy)).toContain("R1:raw-primitive:src/legacy.ts:clock");
  writeApp(app, { "kit/debt/legacy.json": JSON.stringify({ ...legacy, "stale-debt": null }) });
  const tightened = run(["--tighten"]);
  expect(tightened.status, tightened.stdout + tightened.stderr).toBe(1);
  expect(tightened.stderr).toContain("R1:raw-primitive:src/core/readings/value.ts:clock");
  expect(JSON.parse(readFileSync(join(app, "kit/debt/legacy.json"), "utf8"))).toEqual(legacy);

  const compared = run(["--fresh-compare"]);
  expect(compared.status, compared.stdout + compared.stderr).toBe(1);
  expect(existsSync(observed)).toBe(true);
  expect(compared.stdout).toContain("the cached snapshot equals a fresh extraction");
  expect(compared.stderr).toContain("R1:raw-primitive:src/core/readings/value.ts:clock");

  writeApp(app, {
    "spec/count.md": topic,
    "src/core/readings/value.ts": source,
    "oracle/count/reads.test.ts":
      "import { value } from '../../src/core/readings/value.js';\nvoid value();\n",
  });
  const semantic = run();
  expect(semantic.status, semantic.stdout + semantic.stderr).toBe(1);
  expect(existsSync(observed), "valid metadata must continue into semantic compilation").toBe(true);
  expect(semantic.stdout).toContain('"reused":false');
  expect(semantic.stderr).toContain("R1:raw-primitive:src/core/readings/value.ts:clock");
  expect(semantic.stderr).not.toContain("R4:topic-shape:");
  expect(semantic.stderr).not.toContain("R3:missing-proof:");
  expect(semantic.stderr).not.toContain("R3:comment-citation:");
}, 240_000);
