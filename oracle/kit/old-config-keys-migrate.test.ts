import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { hostOf } from "../../src/core/readings/host-of.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";
import { configuredKit, kitConfig, testRoots } from "../../scripts/kit-config.mjs";
import { migratedConfig, migratedConfigText } from "../../scripts/kit-migrate-config.mjs";

const old =
  "# Config\n\nProse stays.\n\n```yaml\nroots: { src: [src/, oracle/], spec: spec/, oracle: oracle/ }\nterms: spec/terms.md\n" +
  "exceptions: [oracle/count/increments.test.ts, src/start.ts]\nlegacy-test-roots: [checks/]\n" +
  "packages:\n  - { name: vitest, capabilities: [test-runner], entrypointExports: [test, expect] }\n" +
  "adapters:\n  - { module: src/shell/adapters/surface, export: surface, capability: rendering, kind: external, zones: [shell], contract: { type: Surface }, globals: [document] }\n" +
  "```\n\nMore prose.\n";
const files = {
  "src/shell/adapters/surface.ts":
    "export interface Surface { title(): string; }\nexport const surface: Surface = { title: () => document.title };\n",
  "src/shell/compositions/view.ts": "export function view(): string { return document.title + Date.now(); }\n",
  "src/substrate/compositions/serve.ts": "export function serve(read: () => string): string { return read() + document.title; }\n",
  "src/start.ts":
    "import { view } from './shell/compositions/view.js';\nimport { serve } from './substrate/compositions/serve.js';\nserve(view);\n",
  "oracle/count/increments.test.ts": "if (1 + 1 !== 2) throw new Error('Mismatch');\n",
};
const findingsOf = (text: string) => {
  const config = configuredKit(DEFAULT_CONFIG, kitConfig(text));
  return capabilityCheck(sourceFixture(files, config)).findings;
};

test("the old keys are read in place of hosts with one non-blocking note each", () => {
  const findings = findingsOf(old);
  expect(findings.filter((item) => item.debtKey.startsWith("R1:deprecated-config:"))).toEqual(
    ["entrypointExports", "exceptions", "legacy-test-roots"].map((key) =>
      expect.objectContaining({ debtKey: `R1:deprecated-config:${key}`, blocking: false, category: "checker-limit" }),
    ),
  );
  expect(findings.some((item) => item.debtKey.startsWith("R1:window-authority:src/substrate/"))).toBe(true);
});

test("a migrated configuration gives the same findings apart from the deprecation notes", () => {
  const model = hostOf(configuredKit(DEFAULT_CONFIG, kitConfig(old)));
  const text = migratedConfigText(old, model);
  expect(text.startsWith("# Config\n\nProse stays.\n\n```yaml\n")).toBe(true);
  expect(text.endsWith("```\n\nMore prose.\n")).toBe(true);
  const declaration = kitConfig(text);
  expect(Object.keys(declaration)).not.toEqual(expect.arrayContaining(["exceptions"]));
  expect(declaration).not.toHaveProperty("legacy-test-roots");
  expect(declaration.hosts).toEqual({
    browser: { lib: ["dom"], zone: "shell" },
    server: { lib: ["node", "webworker"], zone: "substrate" },
    proof: {
      lib: ["dom", "node"],
      entries: ["oracle/count/increments.test.ts"],
      roots: ["checks"],
      provides: { vitest: ["test", "expect"] },
    },
    startup: { lib: ["dom", "node", "webworker"], entries: ["src/start.ts"], provides: { vitest: ["test", "expect"] } },
  });
  expect(testRoots(declaration)).toEqual(testRoots(kitConfig(old)));
  const before = findingsOf(old).filter((item) => !item.debtKey.startsWith("R1:deprecated-config:"));
  expect(findingsOf(text)).toEqual(before);
  expect(before.length).toBeGreaterThan(0);
});

test("a configuration without old keys or hosts is written out as the hosts its zones imply", () => {
  const declaration = { roots: { src: "src/", spec: "spec/", oracle: "oracle/" }, terms: "spec/terms.md" };
  expect(migratedConfig(declaration, hostOf(configuredKit(DEFAULT_CONFIG, declaration))).hosts).toEqual({
    browser: { lib: ["dom"], zone: "shell" },
    server: { lib: ["node", "webworker"], zone: "substrate" },
    proof: { lib: ["dom", "node"] },
  });
});
