import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { readSnapshot } from "../../src/substrate/primitives/read-snapshot.js";

const KIT = fileURLToPath(new URL("../..", import.meta.url));
const kit = readSnapshot(KIT);

test("the kit's own comments cite nothing and carry no debt (R3)", () => {
  expect(kit.comments.length).toBeGreaterThan(0);
  expect(commentCheck(kit)).toEqual([]);
});
