import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { bindingFindings } from "../lib/bindingFindings.js";

// The kit follows its own layout: its spec headings, its source files and its tests name the same artifacts.
const KIT = fileURLToPath(new URL("../..", import.meta.url));
const kit = readSnapshot(KIT);

test("every kit source file under src/ is placed", () => {
  const legacy = kit.files
    .filter((f) => f.type === "source" && f.path.startsWith("src/"))
    .filter((f) => !placementOf(f.path, "src").placed);
  expect(legacy).toEqual([]);
});

test("the kit's own imports obey R2", () => {
  expect(kit.imports.length).toBeGreaterThan(0);
  expect(dependencyCheck(kit)).toEqual([]);
});

test("kit/spec, kit/src and the kit's tests bind with no finding (R3)", () => {
  expect(kit.headings.length).toBeGreaterThan(0);
  expect(bindingFindings(kit)).toEqual([]);
});
