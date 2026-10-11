import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { binder } from "../../../src/core/reading/binder.js";
import { dependencyCheck } from "../../../src/core/reading/dependencyCheck.js";
import { kindOf } from "../../../src/core/reading/kindOf.js";
import { readSnapshot } from "../../../src/substrate/effect/readSnapshot.js";

// The kit follows its own layout. The binder's heading checks wait on kit/spec; until then only its
// test-name checks run here.
const KIT = fileURLToPath(new URL("../../..", import.meta.url));
const kit = readSnapshot(KIT);

test("every kit source file under src/ is placed", () => {
  const legacy = kit.files
    .filter((f) => f.type === "source" && f.path.startsWith("src/"))
    .filter((f) => !kindOf(f.path, "src").placed);
  expect(legacy).toEqual([]);
});

test("the kit's own imports obey R2", () => {
  expect(kit.imports.length).toBeGreaterThan(0);
  expect(dependencyCheck(kit)).toEqual([]);
});

test("every kit test names a kit artifact", () => {
  const testFindings = binder(kit).filter((f) => /^R3:(?:orphan-test|test-name):/.test(f.debtKey));
  expect(testFindings).toEqual([]);
});
