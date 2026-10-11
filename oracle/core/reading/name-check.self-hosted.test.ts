import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { nameCheck } from "../../../src/core/reading/name-check.js";
import { readSnapshot } from "../../../src/substrate/effect/read-snapshot.js";

// The kit speaks its own language: its terms file defines every word of its module names, exported
// symbols and test module prefixes.
const KIT = fileURLToPath(new URL("../../..", import.meta.url));
const kit = readSnapshot(KIT);

test("the kit's names use only its terms and connectors (R3)", () => {
  expect(kit.terms.length).toBeGreaterThan(0);
  expect(nameCheck(kit)).toEqual([]);
});
