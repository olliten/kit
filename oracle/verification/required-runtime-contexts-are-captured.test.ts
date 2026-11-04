import { join } from "node:path";
import { expect, test } from "vitest";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { testLine } from "../../src/core/readings/verification-configuration.js";
import { runtimeOf, verdictKind } from "../../src/core/readings/verdict-reuse.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const roots = { src: "src", spec: "spec", oracle: "oracle" };
const read = (contexts: unknown) => configuredKit(DEFAULT_CONFIG, { roots, verify: {
  checks: [], tests: { command: "node {test} {dir}", under: "oracle", contexts },
} });

test("required contexts use distinct names and participate in canonical test command identity", () => {
  expect(read(["browser", "worker"]).verify?.tests?.[0]?.contexts).toEqual(["browser", "worker"]);
  expect(testLine("node {test}", "oracle/a.test.ts", ["worker", "browser"])).toBe(testLine("node {test}", "oracle/a.test.ts", ["browser", "worker"]));
  expect(testLine("node {test}", "oracle/a.test.ts", ["browser"])).not.toBe(testLine("node {test}", "oracle/a.test.ts"));
  for (const contexts of [["browser", "browser"], ["../browser"], ["Browser"], ["browser/context"], ["browser,worker"], [""], "browser"])
    expect(() => read(contexts)).toThrow();
});

// A producer-protocol fixture: it proves that required external capture cannot silently disappear. The
// synthetic sidecar does not claim to establish that a real browser's source mapping is correct.
test("requiring browser capture invalidates Node-only passes and missing capture denies independent credit", async () => {
  const project = temporaryProjects.open("kit-required-context-");
  const proof = "oracle/sums/sums.test.ts";
  const module = "src/core/readings/total.ts";
  const command = "node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
  const config = (required: boolean) => "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n" +
    `    command: ${command}\n    under: oracle/\n${required ? "    contexts: [browser]\n" : ""}\`\`\`\n`;
  const exercise = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../../src/core/readings/total.ts';\ntest('sum', () => { assert.equal(total([1, 2]), 3); });\n";
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        noEmit: true, allowImportingTsExtensions: true, types: [],
      }, include: ["src/**/*.ts"] }),
      "kit/config.md": config(false),
      [module]: "export function total(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0); }\n",
      [proof]: exercise,
      "spec/terms.md": "# Terms\n\n- **total** — the sum.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/sums.md": "# Sums\n\nSums.\n\n## Total\n\n- A total sums values ({{total}}). · {#sums}\n",
    });
    const request = (...flags: string[]) => ({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags] });
    const debts = async () => {
      const report = JSON.parse((await runCheck(request("--report"))).stdout);
      return report.findings.map((item: { readonly debtKey: string }) => item.debtKey);
    };
    expect((await runVerify(request())).exitCode).toBe(0);
    expect(await debts()).not.toContain(`R4:ungoverned-function:${module}:total`);
    project.write({ "kit/config.md": config(true) });
    const required = await runVerify(request());
    expect(required.exitCode, required.stderr).toBe(0);
    expect(required.stdout).toContain(`passed test:${proof}`);
    expect(required.stdout).not.toContain(`reused test:${proof}`);
    expect(await debts()).toContain(`R4:ungoverned-function:${module}:total`);
    const sidecar = { complete: true, runtime: toolchain.runtime(project.root), loaded: [proof, module] };
    project.write({ [proof]: exercise +
      "import { join } from 'node:path';\nimport { readFileSync, writeFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';\n" +
      `const own = join(process.env.KIT_COVERAGE, ${JSON.stringify(encodeURIComponent(proof))});\n` +
      `assert.equal(process.env.KIT_TEST, ${JSON.stringify(proof)});\nassert.equal(process.env.KIT_RUNTIME, ${JSON.stringify(sidecar.runtime)});\n` +
      "const facts = JSON.parse(readFileSync(process.env.KIT_FUNCTIONS, 'utf8'));\nassert.equal(facts.version, 1);\n" +
      `const original = readFileSync(${JSON.stringify(module)}, 'utf8');\n` +
      `assert.equal(facts.sourceHashes[${JSON.stringify(module)}], createHash('sha256').update(original).digest('hex'));\n` +
      `const named = facts.functions.find((fn) => fn.file === ${JSON.stringify(module)} && fn.id === 'total');\n` +
      "assert.equal(original.slice(named.start, named.end), original.trimEnd());\n" +
      `writeFileSync(join(own, 'browser-context.json'), ${JSON.stringify(JSON.stringify(sidecar))});\n`,
    });
    const captured = await runVerify(request());
    expect(captured.exitCode, captured.stderr).toBe(0);
    const line = testLine(command, proof, ["browser"]);
    const kept = evidenceStore.entries(evidenceStore.directory(project.root), verdictKind(`test:${proof}`, line,
      runtimeOf(line, toolchain.runtime(project.root), toolchain.scripts(project.root)))).map((entry) => JSON.parse(entry));
    expect(await debts(), JSON.stringify(kept.map((entry) => entry.execution))).not.toContain(`R4:ungoverned-function:${module}:total`);
  } finally {
    project.dispose();
  }
}, 120_000);
