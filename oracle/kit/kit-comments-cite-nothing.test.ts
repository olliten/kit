import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { configuredKit, kitConfig } from "../../scripts/kit-config.mjs";

const KIT = fileURLToPath(new URL("../..", import.meta.url));
const config = configuredKit(
  DEFAULT_CONFIG,
  kitConfig(readFileSync(new URL("../../self-config.md", import.meta.url), "utf8")),
);
const kit = readSnapshot(KIT, config);

test("the kit's own comments cite nothing and carry no debt (R3)", () => {
  expect(kit.comments.length).toBeGreaterThan(0);
  expect(commentCheck(kit)).toEqual([]);
});
