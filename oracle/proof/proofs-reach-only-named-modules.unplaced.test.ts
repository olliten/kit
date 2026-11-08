import { expect, test } from "vitest";
import { capabilityCheck } from "../../src/core/compositions/capability-check.js";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { layoutCheck } from "../../src/core/readings/layout-check.js";
import { legacySize } from "../../src/core/readings/legacy-size.js";
import { proofScope } from "../../src/core/readings/proof-scope.js";
import { ratchetFindings } from "../../src/core/readings/ratchet.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedUses } from "../substrate/compositions/recorded-reach.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const claim = { file: "spec/topic.md", anchor: "total-sums", line: 1, terms: ["total"] };
const proof = "oracle/topic/total-sums.test.ts";
const total = "src/core/readings/total.ts";
const round = "src/core/readings/round.ts";
const debt = `R4:proof-scope:spec/topic.md:total-sums:${round}`;

// A claim naming `total` whose test reaches `round` along the given imports.
function keys(imports: string[], files: string[], config: Partial<KitConfig> = {}): string[] {
  const snapshot = snapshotOf({ files: [total, round, proof, ...files], imports, claims: [claim] });
  return proofScope({ ...snapshot, config: { ...snapshot.config, ...config } }).map((finding) => finding.debtKey);
}
const through = (helper: string): string[] => [`${proof} > ${helper}`, `${helper} > ${total}`, `${helper} > ${round}`];

// An unplaced helper in a code root, and one in a legacy location.
const inRoot = "src/legacy/app.ts";
const legacy = "spec/harness/app.ts";
const layout = { layout: { legacy: ["spec/harness"] } };

test("what a test reaches only through unplaced code is that code's debt, not the test's", () => {
  expect(keys(through(inRoot), [inRoot])).toEqual([]);
  expect(keys(through(legacy), [legacy], layout)).toEqual([]);
  // Reaching it through other unplaced code still stops there.
  expect(keys([`${proof} > src/legacy/util.ts`, `src/legacy/util.ts > ${inRoot}`, ...through(inRoot).slice(1)], [inRoot, "src/legacy/util.ts"])).toEqual([]);
});

test("a placed module the test reaches directly is still charged", () => {
  expect(keys([...through(inRoot), `${proof} > ${round}`], [inRoot])).toEqual([debt]);
});

test("a placed module the test reaches through other placed unnamed code is still charged", () => {
  const helper = "src/core/readings/helper.ts";
  const helperDebt = `R4:proof-scope:spec/topic.md:total-sums:${helper}`;
  expect(keys([...through(inRoot), `${proof} > ${helper}`, `${helper} > ${round}`], [inRoot, helper])).toEqual([helperDebt, debt]);
  // Placed code in front of unplaced code is charged; what the unplaced code reaches is not.
  expect(keys([`${proof} > ${total}`, `${proof} > ${helper}`, `${helper} > ${inRoot}`, `${inRoot} > ${round}`], [inRoot, helper])).toEqual([helperDebt]);
});

// What a test reaches "directly, or through placed code" is what its code uses there, as the compiler follows
// it: a placed helper the test imports lends it only what the helper's code it runs uses.
test("the compiler records which file's code led into which, only where code is used", () => {
  const uses = recordedUses(
    {
      "src/round.ts": "export const round = (n: number): number => Math.round(n);\n",
      "src/helper.ts": [
        'import { round } from "./round.js";',
        "export const label = (n: number): string => `#${n}`;",
        "export const rounded = (n: number): number => round(n);",
        "",
      ].join("\n"),
      "src/use.test.ts": 'import { label } from "./helper.js";\nvoid label(1);\n',
    },
    "src/use.test.ts",
  );
  expect(uses).toEqual([{ from: "src/use.test.ts", to: "src/helper.ts" }]);
});

test("a placed module the test could import only through placed code it never uses there is reached only through the unplaced code", () => {
  const helper = "src/core/readings/helper.ts";
  const helperDebt = `R4:proof-scope:spec/topic.md:total-sums:${helper}`;
  const files = [total, round, proof, helper, inRoot];
  const imports = [`${proof} > ${total}`, `${proof} > ${helper}`, `${helper} > ${round}`, `${proof} > ${inRoot}`, `${inRoot} > ${round}`];
  const recorded = (uses: readonly string[]): string[] => {
    const { compiler } = projectSnapshot({
      files,
      proofs: [
        {
          file: proof,
          reached: [proof, total, helper, inRoot, round],
          whole: [],
          uses: uses.map((edge) => {
            const [from = "", to = ""] = edge.split(" > ");
            return { from, to };
          }),
        },
      ],
    });
    if (compiler === undefined) throw new Error("the project snapshot holds no compiler facts");
    return proofScope({ ...snapshotOf({ files, imports, claims: [claim] }), compiler }).map((finding) => finding.debtKey);
  };
  const used = [`${proof} > ${total}`, `${proof} > ${helper}`, `${proof} > ${inRoot}`, `${inRoot} > ${round}`];
  // The helper's code the test runs never uses `round`: `round` arrives only through the unplaced app.
  expect(recorded(used)).toEqual([helperDebt]);
  // Once the helper's code the test runs uses `round`, it is the test's again.
  expect(recorded([...used, `${helper} > ${round}`])).toEqual([helperDebt, debt]);
});

test("unplaced code the check doesn't count as debt carries no reach", () => {
  // Outside every code root, with no layout declared, nothing counts it, so its reach stays the test's.
  expect(keys(through(legacy), [legacy])).toEqual([debt]);
  // A declared entrypoint is no debt either.
  expect(keys(through(inRoot), [inRoot], { exceptions: [inRoot] })).toEqual([debt]);
});

// Placed production and proof code, an unplaced helper, with no legacy zone declared, and a proof importing it.
function migrations(): string[] {
  const page = "oracle/shell/compositions/page.ts";
  const store = "src/substrate/compositions/store.ts";
  const driver = "oracle/core/readings/driver.ts";
  const edge = (file: string, target: string) => ({ file, specifier: target, target, typeOnly: false });
  const files = [page, store, driver, legacy, proof];
  const snapshot = projectSnapshot(
    {
      files,
      imports: [edge(proof, legacy), edge(driver, legacy), edge(legacy, page), edge(store, legacy)],
    },
    { srcRoot: ["oracle", "src"], layout: { legacy: ["spec"] }, exceptions: [proof] },
  );
  const typed: Snapshot = { ...snapshot, files: files.map((path) => ({ path, type: path === proof ? "test" : "source" })) };
  return capabilityCheck(typed)
    .findings.filter((item) => item.debtKey.startsWith("R1:migration-zone:"))
    .map((item) => item.debtKey)
    .sort();
}

test("an import from a test, or placed proof code, into unplaced code is no migration-zone limit", () => {
  expect(migrations()).toEqual([
    `R1:migration-zone:${legacy}:oracle/shell/compositions/page.ts`,
    `R1:migration-zone:src/substrate/compositions/store.ts:${legacy}`,
  ]);
});

test("a new unplaced module is new debt, so it fails", () => {
  const config: Partial<KitConfig> = { srcRoot: ["oracle", "src"], layout: { legacy: ["spec/harness"] } };
  const findings = (snapshot: Snapshot) => [...layoutCheck(snapshot), ...legacySize(snapshot)];
  const held = sourceFixture({ [legacy]: "export const one: number = 1;" }, config);
  const before = findings(held);
  const baseline = {
    ...Object.fromEntries(layoutCheck(held).map(({ debtKey }) => [debtKey, null])),
    ...Object.fromEntries(legacySize(held).map(({ debtKey, statements, calls }) => [debtKey, { statements, calls }])),
  };
  expect(ratchetFindings(before, baseline, [], [])).toEqual([]);
  const after = sourceFixture(
    {
      [legacy]: "export const one: number = 1;",
      "spec/harness/new.ts": "export const two: number = 2;",
      "oracle/topic/total.harness.ts": "export const three: number = 3;",
    },
    config,
  );
  expect(ratchetFindings(findings(after), baseline, [], []).map((item) => item.debtKey).sort()).toEqual([
    "R1:file-role:spec/harness/new.ts",
    "R1:legacy-size:oracle/topic/total.harness.ts",
    "R1:legacy-size:spec/harness/new.ts",
  ]);
});

test("no key declares shared test code: harnesses is not a key Kit reads", () => {
  const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
  const harnesses = [{ under: "spec/harness/", reason: "shared drivers" }];
  expect(() => configuredKit(DEFAULT_CONFIG, { roots, harnesses })).toThrow(/^harnesses is not a key Kit reads\./);
});
