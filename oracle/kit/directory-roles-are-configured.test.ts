import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { layoutCheck } from "../../src/core/readings/layout-check.js";
import { legacySize } from "../../src/core/readings/legacy-size.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

import { configuredKit } from "../../src/core/readings/kit-configuration.js";
import { ratchetFindings, tightenedBaseline } from "../../src/core/readings/ratchet.js";
const config: Partial<KitConfig> = {
  srcRoot: ["implementation", "proofs"], oracleRoot: "proofs", specRoot: "promises",
  layout: { legacy: [] },
};

test("custom directory names permit both placed and unplaced code in target roots", () => {
  const snapshot = sourceFixture({
    "implementation/core/readings/answer.ts": "export const answer: number = 42;",
    "implementation/old.ts": "export const old: number = 1;",
    "proofs/helpers.ts": "export const value: number = 1;",
    "proofs/topic/claim.test.ts": "export {};",
    "promises/topic.md": "# Topic\n",
    "docs/notes.md": "# Notes\n",
    "implementation/icon.svg": "<svg/>",
  }, config);
  expect(layoutCheck(snapshot)).toEqual([]);
  expect(legacySize(snapshot).map(({ path }) => path)).toEqual([
    "implementation/old.ts", "proofs/helpers.ts",
  ]);
});

test("misplaced files fail without an explicit legacy location, even if baselined", () => {
  const snapshot = sourceFixture({
    "implementation/old.test.ts": "export {};",
    "promises/helper.ts": "export const value: number = 1;",
    "tools/run.ts": "export {};",
    "implementation/topic.md": "# Topic\n",
  }, config);
  const findings = layoutCheck(snapshot);
  expect(findings.map(({ path }) => path)).toEqual([
    "implementation/old.test.ts", "implementation/topic.md", "promises/helper.ts", "tools/run.ts",
  ]);
  expect(findings.every(({ category }) => category === "placed-violation")).toBe(true);
  const baseline = Object.fromEntries(findings.map(({ debtKey }) => [debtKey, null]));
  expect(ratchetFindings(findings, baseline, [], [])).toEqual(findings);
});

test("old misplaced proofs remain debt but a new proof in the same location fails", () => {
  const legacy = { ...config, layout: { legacy: ["promises"] } };
  const before = sourceFixture({ "promises/old.test.ts": "export {};" }, legacy);
  const findings = layoutCheck(before);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.category).toBe("legacy-debt");
  const baseline = Object.fromEntries(findings.map(({ debtKey }) => [debtKey, null]));
  expect(ratchetFindings(findings, baseline, [], [])).toEqual([]);
  const after = sourceFixture({
    "promises/old.test.ts": "export {};", "promises/new.test.ts": "export {};",
  }, legacy);
  expect(ratchetFindings(layoutCheck(after), baseline, [], []).map(({ path }: {path: string}) => path))
    .toEqual(["promises/new.test.ts"]);
  const tightened = tightenedBaseline(baseline, []);
  expect(tightened).toEqual({});
  expect(ratchetFindings(findings, tightened, [], [])).toEqual(findings);
});

test("a legacy test resembling a module path retains its actual test role", () => {
  const path = "implementation/core/readings/answer.test.ts";
  const snapshot = sourceFixture({ [path]: "export {};" }, {
    ...config, layout: { legacy: [path] },
  });
  expect(layoutCheck(snapshot)).toEqual([
    expect.objectContaining({ path, category: "legacy-debt" }),
  ]);
  expect(snapshot.files.find((file) => file.path === path)?.type).toBe("test");
  expect(legacySize(snapshot)).toEqual([]);
});

test("old configurations retain behavior until layout adoption", () => {
  const snapshot = sourceFixture({ "spec/old.test.ts": "export {};" });
  expect(layoutCheck(snapshot)).toEqual([]);
});

test("configuration normalizes only explicit legacy paths", () => {
  const declared = configuredKit(DEFAULT_CONFIG, {
    roots: { src: ["implementation/", "proofs/"], oracle: "proofs/", spec: "promises/" },
    layout: { legacy: ["old-tests/", "tools/run.ts", "old-tests/"] },
  });
  expect(declared.layout).toEqual({ legacy: ["old-tests", "tools/run.ts"] });
  expect(declared.srcRoot).toEqual(["implementation", "proofs"]);
});

test.each([
  null, true, [], {}, { legacy: "old" }, { legacy: [], exempt: true },
  ...["", ".", "..", "../old", "old/../tools", "./old", "/old", " old", "old ",
    "old/*", "!old", "old\\tools", "C:/old"].map((path) => ({ legacy: [path] })),
])("malformed layout %j rejects configuration", (layout) => {
  expect(() => configuredKit(DEFAULT_CONFIG, {
    roots: { src: ["implementation", "proofs"], oracle: "proofs", spec: "promises" }, layout,
  })).toThrow();
});

test("missing legacy locations and partially governed proof roots fail", () => {
  const snapshot = sourceFixture({ "implementation/old.ts": "export {};" }, config);
  expect(() => layoutCheck({ ...snapshot, config: {
    ...snapshot.config, layout: { legacy: ["missing"] },
  } })).toThrow(/matches no existing file/);
  expect(() => layoutCheck({ ...snapshot, config: { ...snapshot.config, srcRoot: "implementation" } }))
    .toThrow(/proof root/);
  expect(() => layoutCheck({ ...snapshot, config: {
    ...snapshot.config, srcRoot: ["implementation", "proofs", "promises"],
  } })).toThrow(/non-overlapping/);
});
