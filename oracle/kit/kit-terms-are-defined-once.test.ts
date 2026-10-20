import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { configuredKit, kitConfig } from "../../scripts/kit-config.mjs";

// Whole module concept binding has its own proof; these checks retain unique definitions and retired words.
const KIT = fileURLToPath(new URL("../..", import.meta.url));
const config = configuredKit(
  DEFAULT_CONFIG,
  kitConfig(readFileSync(new URL("../../self-config.md", import.meta.url), "utf8")),
);
const kit = readSnapshot(KIT, config);

test("the kit has unique global definitions and no retired scanned words (R3)", () => {
  expect(kit.terms.length).toBeGreaterThan(0);
  expect(nameCheck(kit)).toEqual([]);
});
