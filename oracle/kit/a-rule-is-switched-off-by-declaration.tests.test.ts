import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { gate } from "../../src/core/compositions/gate.js";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";

const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
const reason = "The browser and runtime tests drive the host by design; production code keeps the rule.";
const source = "src/core/readings/read.ts";
const proof = "oracle/text/reads.test.ts";
const legacy = "spec/reads.test.ts";
const uses = 'export function read(): unknown { return process.getBuiltinModule("node:fs"); }\n';

// The ambient-global findings, by path, of a reading and two tests that each use the Node runtime's `process`.
// The proof root is a code root and the legacy test an entrypoint in a legacy location, so both are checked; the
// fixture compiles only the tests a config names as entrypoints.
const checked = { srcRoot: ["oracle", "src"], layout: { legacy: ["spec"] }, exceptions: [proof, legacy] };
const facts = recordedAuthority({
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      types: ["node"],
      typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ["src/**/*.ts", "oracle/**/*.ts", "spec/**/*.ts"],
  }),
  "package.json": JSON.stringify({ type: "module" }),
  [source]: uses,
  [proof]: uses,
  [legacy]: uses,
}, checked);
function flagged(rules: KitConfig["rules"]): string[] {
  const base = projectSnapshot(facts, { ...checked, ...(rules === undefined ? {} : { rules }) });
  const snapshot: Snapshot = {
    ...base,
    files: [
      { path: source, type: "source" },
      { path: proof, type: "test" },
      { path: legacy, type: "test" },
    ],
  };
  return [...new Set(gate(snapshot, snapshot.config).findings.filter((item) => item.debtKey.startsWith("R1:ambient-global:")).map((item) => item.path))].sort();
}

test("a rule scoped to production code reports nothing on tests and everything elsewhere", () => {
  expect(flagged(undefined)).toEqual([proof, source, legacy].sort());
  const config = configuredKit(DEFAULT_CONFIG, { roots, rules: { "ambient-global": { tests: "off", reason } } });
  expect(config.rules).toEqual({ "ambient-global": { tests: "off", reason } });
  expect(flagged(config.rules)).toEqual([source]);
  // Scoping another rule leaves this one reporting on tests.
  expect(flagged({ "native-authority": { tests: "off", reason } })).toEqual([proof, source, legacy].sort());
});

test("the switch-off form keeps working beside a scoped rule", () => {
  const config = configuredKit(DEFAULT_CONFIG, {
    roots,
    rules: { "excerpt-cohesion": { off: reason }, "native-authority": { tests: "off", reason } },
  });
  expect(config.rules).toEqual({ "excerpt-cohesion": { off: reason }, "native-authority": { tests: "off", reason } });
});

test("a scoped rule without tests: off and a nonempty reason, or with another key, is a configuration error", () => {
  const read = (rules: unknown) => () => configuredKit(DEFAULT_CONFIG, { roots, rules });
  expect(read({ "native-authority": { tests: "off" } })).toThrow(/^rules\.native-authority\.reason: /);
  expect(read({ "native-authority": { tests: "off", reason: " " } })).toThrow(/^rules\.native-authority\.reason: /);
  expect(read({ "ambient-global": { tests: "on", reason } })).toThrow(/^rules\.ambient-global\.tests: /);
  expect(read({ "ambient-global": { tests: false, reason } })).toThrow(/^rules\.ambient-global\.tests: /);
  expect(read({ "ambient-global": { reason } })).toThrow(/^rules\.ambient-global\.tests: /);
  expect(read({ "ambient-global": { off: reason } })).toThrow(/^rules\.ambient-global\.off is not a key Kit reads\./);
  expect(read({ "ambient-global": "off" })).toThrow(/^rules\.ambient-global\.tests: /);
  expect(read({ "excerpt-cohesion": { tests: "off", reason } })).toThrow(/^rules\.excerpt-cohesion\.(?:reason|tests) is not a key Kit reads\./);
  expect(read({ "authority-entry": { tests: "off", reason } })).toThrow(/^rules\.authority-entry is not a key Kit reads\./);
});
