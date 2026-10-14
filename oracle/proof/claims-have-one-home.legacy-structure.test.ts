import { describe, expect, test } from "vitest";
import { claimInventory } from "../../src/core/readings/claim-inventory.js";
import { claimProofBinder } from "../../src/core/readings/claim-proof-binder.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";

describe("legacy declarations retain their structural scope without changing topic grammar", () => {
  const nested = "- A standing claim · {#value-stays}\n  - The explanatory child has no claim.\n";

  test("a legacy parent paragraph closing marker declares its claim before explanatory children", () => {
    expect(claimInventory(nested, { legacy: true, separator: "·" })).toEqual({
      declarations: [{ anchor: "value-stays", line: 1 }],
      references: [],
    });
  });

  test("the same marker remains a reference in a new topic whose parent item continues", () => {
    expect(claimInventory(nested, { separator: "·" })).toEqual({
      declarations: [],
      references: [{ anchor: "value-stays", line: 1 }],
    });
  });

  test("an annotated legacy law heading declares its identity without mistaking its description for the anchor", () => {
    expect(
      claimInventory("### law · value-stays — a standing rule\n", { legacy: true, separator: "·" }),
    ).toEqual({
      declarations: [{ anchor: "value-stays", line: 1 }],
      references: [],
    });
    expect(
      claimInventory("### law · value-stays — a standing rule\n", { separator: "·" }).declarations,
    ).toEqual([]);
  });

  test("an explicit legacy law marker and its heading identify one declaration, not two", () => {
    const actual = claimInventory("### law · value-stays — a standing rule\n\n- {#value-stays}\n", {
      legacy: true,
      separator: "·",
    });
    expect(actual.declarations.map(({ anchor }) => anchor)).toEqual(["value-stays"]);
    expect(actual.references).toEqual([]);
  });

  test("reflowed references remain references even in a legacy area", () => {
    expect(
      claimInventory("An explanation cites\n{#missing-value}\nand continues.\n", {
        legacy: true,
        separator: "·",
      }),
    ).toEqual({
      declarations: [],
      references: [{ anchor: "missing-value", line: 2 }],
    });
  });

  test("coalescing a heading's own marker does not hide a second body declaration", () => {
    const inventory = claimInventory(
      "### law · value-stays — a standing rule\n\n- {#value-stays}\n- Another declaration · {#value-stays}\n",
      { legacy: true, separator: "·" },
    );
    expect(inventory.declarations.map(({ anchor }) => anchor)).toEqual([
      "value-stays",
      "value-stays",
    ]);
  });

  test("two legacy heading homes remain two declarations", () => {
    const inventory = claimInventory(
      "### law · value-stays — first home\n\n- {#value-stays}\n\n### law · value-stays — second home\n\n- {#value-stays}\n",
      { legacy: true, separator: "·" },
    );
    expect(inventory.declarations.map(({ anchor }) => anchor)).toEqual([
      "value-stays",
      "value-stays",
    ]);
  });

  test("a duplicated legacy parent declaration stays a binder failure despite multiple proofs", () => {
    const claims = claimInventory(`${nested}\n${nested}`, {
      legacy: true,
      separator: "·",
    }).declarations.map((claim) => ({ ...claim, file: "spec/value.md" }));
    const result = claimProofBinder({
      config: DEFAULT_CONFIG,
      files: [
        { path: "oracle/value/value-stays.test.ts", type: "test" },
        { path: "oracle/value/value-stays.replay.test.ts", type: "test" },
      ],
      claims,
      imports: [],
      headings: [],
      terms: [],
      prose: [],
      symbols: [],
      comments: [],
    });
    expect(result).toEqual([
      expect.objectContaining({ debtKey: "R3:duplicate-claim:value-stays" }),
    ]);
  });
});
