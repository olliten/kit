import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { removeCacheApps, scratch, writeApp } from "../lib/cache-fixture.js";

afterEach(removeCacheApps);

const engine = resolve(import.meta.dirname, "../..");
const { kitRefs } = await import(new URL("../../scripts/kit-refs.mjs", import.meta.url).href);

test("--fresh-compare keeps evidence for code roots and proof entrypoints without waiving failures", async () => {
  const base = scratch("kit-fresh-compare-");
  const app = join(base, "app");
  const proofSource =
    "import { actual } from '../../src/core/readings/actual.js';\nimport { reference } from '../../oracle/core/readings/reference.js';\nif (actual(1) !== reference(1)) throw new Error('Mismatch');\n";
  const configSource =
    "```yaml\napp: numbers\nroots:\n  src: [src/, oracle/, proof/]\n  spec: spec/\n  oracle: proof/\nterms: spec/terms.md\nexceptions: [proof/count/increments.test.ts]\n```\n";
  writeApp(app, {
    "package.json": JSON.stringify({ type: "module" }),
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
      include: ["src/**/*.ts", "oracle/**/*.ts", "proof/**/*.ts"],
    }),
    "src/core/readings/actual.ts": "export function actual(n: number): number { return n + 1; }\n",
    "oracle/core/readings/reference.ts":
      "export function reference(n: number): number { return n + 1; }\n",
    "spec/terms.md":
      "# Terms\n\n- **actual** — the implementation.\n  - Role: derived\n  - Zone: core\n  - From: []\n- **reference** — the independent expectation.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
    "spec/count.md":
      "# Count\n\nCounting.\n\n## Increment\n\n- The implementation agrees with the reference ({{actual}}, {{reference}}). · {#increments}\n",
    "proof/count/increments.test.ts": proofSource,
    "kit/config.md": configSource,
    "kit/debt/legacy.json": "{}",
  });
  // Own the Git cache boundary instead of inheriting a parent checkout's store.
  mkdirSync(join(app, ".git"));
  const run = (flags: readonly string[] = []) =>
    spawnSync(
      process.execPath,
      [
        join(engine, "scripts/kit-check.mjs"),
        "--root=.",
        "--config=kit/config.md",
        "--baseline=kit/debt/legacy.json",
        "--fresh-compare",
        ...flags,
      ],
      {
        cwd: app,
        encoding: "utf8",
        timeout: 240_000,
        env: { ...process.env, XDG_CACHE_HOME: join(base, "cache") },
      },
    );
  const cold = run();
  const warm = run();
  for (const result of [cold, warm]) {
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(/diverged/);
    expect(result.stdout).toMatch(/the cached snapshot equals a fresh extraction/);
  }
  expect(cold.stdout).toMatch(/"reused":false/);
  expect(warm.stdout, cold.stderr + warm.stderr).toMatch(/"reused":true/);

  const refs = await kitRefs({
    engineRoot: engine,
    root: app,
    configPath: join(app, "kit/config.md"),
    target: "oracle/core/readings/reference.ts",
  });
  expect(refs.module).toBe("oracle/core/readings/reference");
  expect(refs.claims.map((row: { tests: string[] }) => row.tests)).toEqual([
    ["proof/count/increments.test.ts"],
  ]);

  const baseline = Object.fromEntries(
    ["oracle/core/readings/reference.ts", "src/core/readings/actual.ts"].flatMap((path) => [
      [`R1:raw-primitive:${path}:clock`, null],
      [`R1:reading-authority:${path}:clock`, null],
    ]),
  );
  for (const [path, name] of [
    ["oracle/core/readings/reference.ts", "reference"],
    ["src/core/readings/actual.ts", "actual"],
  ] as const) {
    writeApp(app, {
      "oracle/core/readings/reference.ts":
        "export function reference(n: number): number { return n + 1; }\n",
      [path]: `export function ${name}(n: number): number { return Date.now(); }\n`,
      "kit/debt/legacy.json": JSON.stringify(baseline),
    });
    const red = run();
    expect(red.status, red.stdout + red.stderr).toBe(1);
    expect(red.stdout).toMatch(/"reused":false/);
    expect(red.stdout).toMatch(/the cached snapshot equals a fresh extraction/);
    expect(red.stderr).toContain(`R1:raw-primitive:${path}:clock`);
    expect(red.stderr).toContain(`R1:reading-authority:${path}:clock`);
  }

  writeApp(app, {
    "src/core/readings/actual.ts": "export function actual(n: number): number { return n + 1; }\n",
    "proof/count/increments.test.ts": proofSource + "void Date.now();\n",
    "kit/debt/legacy.json": JSON.stringify({
      "R1:raw-primitive:proof/count/increments.test.ts:clock": null,
    }),
  });
  const proofRed = run();
  expect(proofRed.status, proofRed.stdout + proofRed.stderr).toBe(1);
  expect(proofRed.stdout).toMatch(/the cached snapshot equals a fresh extraction/);
  expect(proofRed.stderr).toContain("R1:raw-primitive:proof/count/increments.test.ts:clock");

  writeApp(app, {
    "proof/count/increments.test.ts": proofSource,
    "src/core/readings/actual.ts": "export function actual(n: number): number { return n + 1; }\n",
    "oracle/core/readings/reference.ts":
      "import { read } from 'mystery';\nexport function reference(n: number): number { return read(); }\n",
    "node_modules/mystery/package.json": JSON.stringify({
      name: "mystery",
      version: "1.0.0",
      type: "module",
      types: "index.d.ts",
    }),
    "node_modules/mystery/index.d.ts": "export function read(): number;\n",
    "kit/debt/legacy.json": JSON.stringify({
      "R1:external-boundary:oracle/core/readings/reference.ts:mystery": null,
    }),
  });
  const limit = run();
  expect(limit.status, limit.stdout + limit.stderr).toBe(1);
  expect(limit.stdout).toMatch(/the cached snapshot equals a fresh extraction/);
  expect(limit.stderr.trim().split("\n")).toHaveLength(1);
  expect(limit.stderr).toContain("R1:external-boundary:oracle/core/readings/reference.ts:mystery");

  const legacy = "oracle/reference.ts";
  writeApp(app, {
    "oracle/core/readings/reference.ts":
      "export function reference(n: number): number { return n + 1; }\n",
    [legacy]:
      "import { read } from 'mystery'; export function legacy(n: number): number { return read() + n; }\n",
  });
  const report = run(["--report"]);
  expect(report.status, report.stderr).toBe(0);
  const inventory = JSON.parse(report.stdout.slice(report.stdout.indexOf("{"))).findings;
  const legacyBaseline = Object.fromEntries(
    inventory
      .filter((item: { category: string }) => item.category === "legacy-debt")
      .map((item: { debtKey: string; statements?: number; calls?: number }) => [
        item.debtKey,
        typeof item.statements === "number"
          ? { statements: item.statements, calls: item.calls }
          : null,
      ]),
  );
  const boundaryKey = `R2:dependency-boundary:${legacy}:node_modules/mystery/index.d.ts`;
  const exclusionKey = `R2:dependency-exclusion:${legacy}:runtime:transitive:src/core/readings/actual.ts`;
  writeApp(app, {
    "kit/debt/legacy.json": JSON.stringify({
      ...legacyBaseline,
      [boundaryKey]: null,
      [exclusionKey]: null,
    }),
  });
  const unrelated = run();
  expect(unrelated.status, unrelated.stdout + unrelated.stderr).toBe(0);
  const policyConfig = configSource.replace(
    "\n```",
    `\ndependency-exclusions:\n  - from: ${legacy}\n    to: src/core/readings/actual.ts\n    imports: runtime\n    reach: transitive\n\`\`\``,
  );
  writeApp(app, { "kit/config.md": policyConfig });
  const opaque = run();
  expect(opaque.status, opaque.stdout + opaque.stderr).toBe(1);
  expect(opaque.stdout).toMatch(/the cached snapshot equals a fresh extraction/);
  expect(opaque.stderr).toContain(boundaryKey);
  expect(opaque.stderr).not.toContain(`R1:external-boundary:${legacy}:mystery`);
  writeApp(app, {
    [legacy]:
      "import { actual } from '../src/core/readings/actual.js'; export function legacy(n: number): number { return actual(n); }\n",
  });
  const dependent = run();
  expect(dependent.status, dependent.stdout + dependent.stderr).toBe(1);
  expect(dependent.stderr).toContain(exclusionKey);
  expect(dependent.stdout).toMatch(/the cached snapshot equals a fresh extraction/);
}, 600_000);
