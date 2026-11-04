import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { configuredKit, kitConfig } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { independentRuns } from "../../src/core/readings/independent-runs.js";
import { runtimeOf, verdictKind, verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { testLine } from "../../src/core/readings/verification-configuration.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { proofRunner } from "../../src/substrate/adapters/proof-runner.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const proof = "oracle/sums/sums.test.ts";
const module = "src/core/readings/total.ts";
const total = "export function total(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0); }\n";
const nodeCommand = "node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
const vitestOptions = "--pool=forks --poolOptions.forks.isolate=true --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 {tests} --coverage.enabled --coverage.all=false --coverage.provider=custom --coverage.customProviderModule={provider} --coverage.reporter=lcovonly --coverage.reportsDirectory={dir}";
const vitestCommand = `node ${proofRunner.location} run ${vitestOptions}`;
// Fixed inline-map fixtures: exact original bytes; changed original bytes; an external source; no mapping.
const maps: Readonly<Record<string, string>> = {
  valid: "eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL29yYWNsZS9oZWxwZXJzL3Byb3ZlbmFuY2UubWpzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBoZWxwZXIoKSB7IHJldHVybiAxOyB9XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEifQ==",
  tampered: "eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL29yYWNsZS9oZWxwZXJzL3Byb3ZlbmFuY2UubWpzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBoZWxwZXIoKSB7IHJldHVybiAyOyB9XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEifQ==",
  outside: "eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL291dHNpZGUubWpzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBoZWxwZXIoKSB7IHJldHVybiAxOyB9XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEifQ==",
  unmapped: "eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL29yYWNsZS9oZWxwZXJzL3Byb3ZlbmFuY2UubWpzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBoZWxwZXIoKSB7IHJldHVybiAxOyB9XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IiJ9",
};

function fixture(command: string) {
  const project = temporaryProjects.open("kit-runtime-attribution-");
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      noEmit: true, allowImportingTsExtensions: true, types: [],
    }, include: ["src/**/*.ts"] }),
    "kit/config.md": "```yaml\nroots: {src: [src/, oracle/], spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n" +
      `    command: ${command}\n    under: oracle/\n\`\`\`\n`,
    [module]: total,
    "spec/terms.md": "# Terms\n\n- **total** — the sum.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
    "spec/sums.md": "# Sums\n\nSums.\n\n## Total\n\n- A total sums values ({{total}}). · {#sums}\n",
  });
  const request = (...flags: string[]) => ({ engineRoot: project.root, cwd: project.root,
    args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags] });
  const passes = () => {
    const line = testLine(command, proof);
    return evidenceStore.entries(evidenceStore.directory(project.root), verdictKind(`test:${proof}`, line,
      runtimeOf(line, toolchain.runtime(project.root), toolchain.scripts(project.root)))).flatMap((entry) => verdictOf(entry) ?? []);
  };
  const governed = () => {
    const [pass] = passes();
    if (pass?.ran === undefined || pass.execution === undefined) return false;
    const config = configuredKit(DEFAULT_CONFIG, kitConfig(textFiles.read(join(project.root, "kit/config.md"))));
    const snapshot = readSnapshot(project.root, config);
    return Object.hasOwn(independentRuns(snapshot, {
      tests: { [proof]: pass.ran }, contexts: { [proof]: pass.execution },
    }).tests, proof);
  };
  return { project, request, passes, governed };
}

test("a real isolated Vitest proof records its original execution and observed inputs through the provider", async () => {
  const { project, request, passes, governed } = fixture(vitestCommand);
  try {
    project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
    const lock = JSON.parse(textFiles.read(fileURLToPath(new URL("../../package-lock.json", import.meta.url))));
    lock.packages["node_modules/unused-for-cache-proof"] = { version: "1.0.0" };
    const manifest = (version: string, metadata: Readonly<Record<string, unknown>> = {}) => JSON.stringify({ type: "module", devDependencies: { "unused-for-cache-proof": version }, ...metadata });
    project.write({
      "package.json": manifest("1.0.0"),
      "package-lock.json": JSON.stringify(lock),
      [proof]: "import { readFileSync } from 'node:fs';\nimport { expect, test } from 'vitest';\nimport { total } from '../../src/core/readings/total.ts';\ntest('sum', () => { expect(total([1, 2])).toBe(3); expect(readFileSync('input.txt', 'utf8')).toBe('v1'); });\n",
      "input.txt": "v1",
    });
    const result = await runVerify(request());
    expect(result.exitCode, result.stderr).toBe(0);
    const [pass] = passes();
    expect(pass?.ran?.[module]).toContain("total@1");
    expect(pass?.execution?.complete).toBe(true);
    expect(pass?.execution?.loaded).toEqual(expect.arrayContaining([proof, module]));
    expect(pass?.states).toHaveProperty("input.txt");
    expect(await governed()).toBe(true);
    const packageStates = Object.fromEntries(Object.entries(pass?.states ?? {}).filter(([key]) => key.startsWith("package") || key.startsWith("#package:")));
    project.write({ "package.json": manifest("2.0.0") });
    expect((await runVerify(request("--plan"))).stdout, JSON.stringify(packageStates)).toContain(`reuse test:${proof}`);
    lock.packages["node_modules/unused-for-cache-proof"] = { version: "2.0.0" };
    project.write({ "package-lock.json": JSON.stringify(lock) });
    expect((await runVerify(request("--plan"))).stdout, JSON.stringify(packageStates)).toContain(`reuse test:${proof}`);
    for (const metadata of [{ workspaces: [] }, { postcss: { plugins: {} } }]) {
      project.write({ "package.json": manifest("2.0.0", metadata) });
      expect((await runVerify(request("--plan"))).stdout).toContain(`run test:${proof}`);
    }
    project.write({ "package.json": manifest("2.0.0") });
    expect((await runVerify(request("--plan"))).stdout).toContain(`reuse test:${proof}`);
    project.write({ "input.txt": "v2" });
    expect((await runVerify(request("--plan"))).stdout).toContain(`run test:${proof}`);
  } finally {
    project.dispose();
  }
}, 120_000);

test("a real transformed JSON import retains its data dependency even when loader metadata can be reused", async () => {
  const { project, request, passes } = fixture(vitestCommand);
  try {
    project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
    const lock = JSON.parse(textFiles.read(fileURLToPath(new URL("../../package-lock.json", import.meta.url))));
    lock.packages["node_modules/unused-for-cache-proof"] = { version: "1.0.0" };
    const manifest = (version: string) => JSON.stringify({ type: "module", devDependencies: { "unused-for-cache-proof": version } });
    project.write({
      "package.json": manifest("1.0.0"), "package-lock.json": JSON.stringify(lock),
      [proof]: "import { expect, test } from 'vitest';\nimport metadata from '../../package.json';\nimport { total } from '../../src/core/readings/total.ts';\n" +
        "test('sum', () => { expect(total([1, 2])).toBe(3); expect(metadata.devDependencies['unused-for-cache-proof']).toBe('1.0.0'); });\n",
    });
    const first = await runVerify(request());
    expect(first.exitCode, first.stderr).toBe(0);
    expect(passes()[0]?.states).toHaveProperty("package.json");
    project.write({ "package.json": manifest("2.0.0") });
    expect((await runVerify(request("--plan"))).stdout).toContain(`run test:${proof}`);
    expect((await runVerify(request())).exitCode).toBe(1);
  } finally {
    project.dispose();
  }
}, 120_000);

test("the default application runner conservatively holds package data read by configuration discovery", async () => {
  const { project, request, passes } = fixture(`node node_modules/vitest/vitest.mjs run ${vitestOptions}`);
  try {
    project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
    const lock = JSON.parse(textFiles.read(fileURLToPath(new URL("../../package-lock.json", import.meta.url))));
    const manifest = (version: string) => JSON.stringify({ type: "module", devDependencies: { "unused-for-cache-proof": version } });
    project.write({
      "package.json": manifest("1.0.0"), "package-lock.json": JSON.stringify(lock),
      [proof]: "import { expect, test } from 'vitest';\nimport { total } from '../../src/core/readings/total.ts';\ntest('sum', () => { expect(total([1, 2])).toBe(3); });\n",
    });
    const first = await runVerify(request());
    expect(first.exitCode, first.stderr).toBe(0);
    expect(passes()[0]?.states).toHaveProperty("package.json");
    project.write({ "package.json": manifest("2.0.0") });
    expect((await runVerify(request("--plan"))).stdout).toContain(`run test:${proof}`);
  } finally {
    project.dispose();
  }
}, 120_000);

test.each(["valid", "missing", "tampered", "malformed", "outside", "unmapped"])(
  "a deleted generated executable with %s source provenance receives credit only for a verified original",
  async (mode) => {
    const { project, request, passes, governed } = fixture(nodeCommand);
    const original = "oracle/helpers/provenance.mjs";
    const helper = "export function helper() { return 1; }\n";
    try {
      const encoded = mode === "malformed" ? "%not-base64%" : maps[mode];
      const generated = helper + (mode === "missing" ? "" : `//# sourceMappingURL=data:application/json;base64,${encoded}\n`);
      project.write({
        [original]: helper,
        "generated/.keep": "",
        [proof]: "import { writeFileSync, unlinkSync } from 'node:fs';\nimport { total } from '../../src/core/readings/total.ts';\n" +
          `writeFileSync('generated/opaque-task.mjs', ${JSON.stringify(generated)});\n` +
          "const { helper } = await import('../../generated/opaque-task.mjs');\nunlinkSync('generated/opaque-task.mjs');\n" +
          "if (total([1, 2]) !== 3 || helper() !== 1) throw new Error('The isolated contract failed.');\n",
      });
      const result = await runVerify(request());
      expect(result.exitCode, result.stderr).toBe(0);
      const [pass] = passes();
      expect(pass?.ran?.[module]).toContain("total@1");
      if (mode === "valid") {
        expect(pass?.execution?.loaded).toContain(original);
        expect(pass?.execution?.loaded).not.toContain("generated/opaque-task.mjs");
        expect(await governed()).toBe(true);
      } else expect(await governed()).toBe(false);
    } finally {
      project.dispose();
    }
  }, 120_000,
);
