import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

// Whole module concept binding has its own proof; these checks retain unique definitions and retired words.
const KIT = fileURLToPath(new URL("../..", import.meta.url));
const kit = readSnapshot(KIT);

test("the kit has unique global definitions and no retired scanned words (R3)", () => {
  expect(kit.terms.length).toBeGreaterThan(0);
  expect(nameCheck(kit)).toEqual([]);
});
