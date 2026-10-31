import { expect, test } from "vitest";
import { capabilityCheck } from "../../src/core/compositions/capability-check.js";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG, type Harness } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { proofScope } from "../../src/core/readings/proof-scope.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";

const claim = { file: "spec/topic.md", anchor: "total-sums", line: 1, terms: ["total"] };
const proof = "oracle/topic/total-sums.test.ts";
const harness = "spec/harness/app.ts";
const reason = "Legacy browser and full-stack drivers every test shares, not yet placed.";

// A claim naming `total` whose test drives the app through an unplaced harness module that reaches `round` too.
function keys(imports: string[], harnesses: readonly Harness[], files: string[] = []): string[] {
  const snapshot = snapshotOf({
    files: ["src/core/readings/total.ts", "src/core/readings/round.ts", harness, proof, ...files],
    imports,
    claims: [claim],
  });
  return proofScope({ ...snapshot, config: { ...snapshot.config, harnesses } }).map((finding) => finding.debtKey);
}
const throughHarness = [`${proof} > ${harness}`, `${harness} > src/core/readings/total.ts`, `${harness} > src/core/readings/round.ts`];
const debt = "R4:proof-scope:spec/topic.md:total-sums:src/core/readings/round.ts";

test("what a test reaches through a declared harness is the harness's", () => {
  expect(keys(throughHarness, [{ under: "spec/harness/", reason }])).toEqual([]);
});

test("the same reach through an undeclared directory is the test's", () => {
  expect(keys(throughHarness, [])).toEqual([debt]);
  expect(keys(throughHarness, [{ under: "spec/lib/", reason }])).toEqual([debt]);
});

test("a placed module the test reaches directly, or through other code, is still charged", () => {
  const harnesses = [{ under: "spec/harness/", reason }];
  expect(keys([...throughHarness, `${proof} > src/core/readings/round.ts`], harnesses)).toEqual([debt]);
  expect(keys([...throughHarness, `${proof} > spec/util.ts`, "spec/util.ts > src/core/readings/round.ts"], harnesses, ["spec/util.ts"])).toEqual([debt]);
  // Reaching the harness through other unplaced code still goes through the harness.
  expect(keys([`${proof} > spec/util.ts`, `spec/util.ts > ${harness}`, ...throughHarness.slice(1)], harnesses, ["spec/util.ts"])).toEqual([]);
});

test("a harness declares a relative directory and a reason, and nothing else", () => {
  const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
  const read = (harnesses: unknown) => () => configuredKit(DEFAULT_CONFIG, { roots, harnesses });
  expect(read([{ under: "spec/harness/", reason }])()).toMatchObject({ harnesses: [{ under: "spec/harness/", reason }] });
  expect(read([{ under: "spec/harness/" }])).toThrow(/^harnesses\[0\]\.reason: /);
  expect(read([{ under: "spec/harness/", reason: " " }])).toThrow(/^harnesses\[0\]\.reason: /);
  for (const under of ["spec/harness", "spec/harness/app.ts", "/spec/harness/", "spec/*/", "../spec/", "./", 3])
    expect(read([{ under, reason }])).toThrow(/^harnesses\[0\]\.under: /);
  expect(read([{ under: "spec/harness/", reason }, { under: "spec/harness/", reason }])).toThrow(/^harnesses\[1\]\.under: repeats harnesses\[0\]/);
  expect(read([{ under: "spec/harness/", reason, files: ["a.ts"] }])).toThrow(/^harnesses\[0\]\.files is not a key Kit reads\./);
  expect(read({ under: "spec/harness/", reason })).toThrow(/^harnesses: /);
  expect(read(["spec/harness/"])).toThrow(/^harnesses\[0\]: /);
});

// Placed code, a legacy harness and a legacy helper outside any harness, with no legacy zone declared, and a
// proof that imports the harness.
function migrations(harnesses: readonly Harness[]): string[] {
  const placed = "oracle/shell/compositions/page.ts";
  const helper = "spec/lib/util.ts";
  const edge = (file: string, target: string) => ({ file, specifier: target, target, typeOnly: false });
  const files = [placed, "src/substrate/compositions/store.ts", harness, helper, proof];
  const snapshot = projectSnapshot(
    {
      files,
      imports: [edge(proof, harness), edge(harness, placed), edge(harness, "src/substrate/compositions/store.ts"), edge(helper, placed)],
    },
    { srcRoot: ["oracle", "src"], layout: { legacy: ["spec"] }, exceptions: [proof], harnesses },
  );
  const typed: Snapshot = { ...snapshot, files: files.map((path) => ({ path, type: path === proof ? "test" : "source" })) };
  return capabilityCheck(typed)
    .findings.filter((item) => item.debtKey.startsWith("R1:migration-zone:"))
    .map((item) => item.debtKey)
    .sort();
}

test("a harness asks no zone: its imports and a test's import of it are no migration-zone limit", () => {
  const helper = "R1:migration-zone:spec/lib/util.ts:oracle/shell/compositions/page.ts";
  const undeclared = migrations([]);
  expect(undeclared).toContain(`R1:migration-zone:${harness}:oracle/shell/compositions/page.ts`);
  expect(undeclared).toContain(helper);
  expect(migrations([{ under: "spec/harness/", reason }])).toEqual([helper]);
});
