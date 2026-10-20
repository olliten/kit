import { expect, test } from "vitest";
import { termInventory } from "../../src/core/readings/term-inventory.js";
import { termOrder } from "../../src/core/readings/term-model.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const order = (text: string) =>
  termOrder({ ...snapshotOf({}), termOrder: termInventory(text).order }).map((row) => [
    row.debtKey,
    row.fix,
  ]);

test("terms in alphabetical order have no finding, whatever their case", () => {
  expect(order("- **limit** — a cap.\n- **Running-total** — a sum.\n- **step** — one change.\n")).toEqual(
    [],
  );
});

test("a term out of order is a finding that names the term it belongs before", () => {
  expect(order("- **step** — one change.\n- **limit** — a cap.\n")).toEqual([
    ["R3:term-order:limit:2", "Place limit in alphabetical order, before step."],
  ]);
});

test("each list is ordered on its own", () => {
  expect(order("## Facts\n\n- **step** — one change.\n\n## Checks\n\n- **limit** — a cap.\n")).toEqual([]);
});
