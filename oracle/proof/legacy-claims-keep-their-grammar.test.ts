import { describe, expect, test } from "vitest";
import { claimInventory } from "../../src/core/readings/claim-inventory.js";
import { claimProofBinder } from "../../src/core/readings/claim-proof-binder.js";
import { proofReach } from "../../src/core/readings/proof-reach.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

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

  test("legacy explanatory children retain the same module relationships as topic metadata", () => {
    const metadata = "  - Implementation: {{value}}\n  - Proof: {{value-cases}}\n";
    const strict = claimInventory("- A standing claim · {#value-stays}\n" + metadata);
    expect(claimInventory(nested + metadata, { legacy: true })).toEqual(strict);
    expect(claimInventory(nested + metadata)).toEqual({
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
    expect(actual).toEqual({
      declarations: [{ anchor: "value-stays", line: 1 }],
      references: [],
    });
  });

  test.each([
    { rows: "  - Implementation: {{value}}\n", relationships: { implementation: ["value"] }, terms: ["value"] },
    { rows: "  - Proof: {{value-cases}}\n", relationships: { proof: ["value-cases"] }, terms: ["value-cases"] },
    {
      rows: "  - Implementation: {{value}}\n  - Proof: {{value-cases}}\n",
      relationships: { implementation: ["value"], proof: ["value-cases"] },
      terms: ["value", "value-cases"],
    },
  ])("the closing marker retains the heading's module metadata: $rows", ({ rows, relationships, terms }) => {
    expect(
      claimInventory("### law · value-stays — a standing rule\n\n- {#value-stays}\n" + rows, {
        legacy: true,
        separator: "·",
      }),
    ).toEqual({
      declarations: [{ anchor: "value-stays", line: 1, terms, ...relationships }],
      references: [],
    });
  });

  test.each([
    { reached: [] },
    { reached: ["value"] },
    { reached: ["value-cases"] },
    { reached: ["value", "value-cases"] },
  ])(
    "an annotated heading survives legacy selection and enforces proof reach, reached=$reached",
    ({ reached }) => {
      const claims = claimInventory(
        "### law · value-stays — a standing rule\n\n- {#value-stays}\n" +
          "  - Implementation: {{value}}\n  - Proof: {{value-cases}}\n",
        { legacy: true, separator: "·" },
      ).declarations
        .filter((claim) => (claim.terms?.length ?? 0) > 0)
        .map((claim) => ({ ...claim, file: "spec/value.md" }));
      const paths = {
        value: "src/core/primitives/value.ts",
        "value-cases": "oracle/core/primitives/value-cases.ts",
      };
      const snapshot = snapshotOf({
        files: [...Object.values(paths), "oracle/value/value-stays.test.ts"],
        claims,
        imports: Object.entries(paths)
          .filter(([name]) => reached.includes(name))
          .map(([, path]) => `oracle/value/value-stays.test.ts > ${path}`),
      });
      const selected = { ...snapshot, config: { ...snapshot.config, srcRoot: ["src", "oracle"] } };
      expect(claims).toHaveLength(1);
      expect(claimProofBinder(selected)).toEqual([]);
      expect(proofReach(selected).map((finding) => finding.debtKey)).toEqual(
        Object.keys(paths)
          .filter((name) => !reached.includes(name))
          .map((name) => `R4:unreached-module:spec/value.md:value-stays:${name}`),
      );
    },
  );

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

  test("coalescing an annotated marker keeps a distinct annotated declaration a duplicate", () => {
    const claims = claimInventory(
      "### law · value-stays — a standing rule\n\n- {#value-stays}\n" +
        "  - Implementation: {{value}}\n" +
        "- Another declaration · {#value-stays}\n  - Implementation: {{other-value}}\n",
      { legacy: true, separator: "·" },
    ).declarations
      .filter((claim) => (claim.terms?.length ?? 0) > 0)
      .map((claim) => ({ ...claim, file: "spec/value.md" }));
    expect(claims.map(({ anchor, line }) => ({ anchor, line }))).toEqual([
      { anchor: "value-stays", line: 1 },
      { anchor: "value-stays", line: 5 },
    ]);
    expect(
      claimProofBinder(
        snapshotOf({ files: ["oracle/value/value-stays.test.ts"], claims }),
      ).map((finding) => finding.debtKey),
    ).toEqual(["R3:duplicate-claim:value-stays"]);
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
