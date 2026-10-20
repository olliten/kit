import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { claimInventory } from "../../src/core/readings/claim-inventory.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { bindingFindings } from "../core/readings/binding-findings.js";

test.each(["· ", ""])(
  "a closing marker after a claim sentence declares it with separator %j",
  (separator) => {
    const inventory = claimInventory(
      `- A reading takes data. ${separator}{#readings-take-data}\n`,
      { separator: "·" },
    );
    expect(inventory.declarations).toEqual([{ anchor: "readings-take-data", line: 1 }]);
    expect(inventory.references).toEqual([]);
  },
);

test.each(["value-stays.bad variant.test.ts", "value-stays..test.ts"])(
  "a valid proof does not hide the malformed claim test %s",
  (name) => {
    const root = mkdtempSync(join(tmpdir(), "kit-malformed-proof-"));
    const malformed = `oracle/value/${name}`;
    const inputs = {
      "spec/value.md": "# value\n\n- A supplied value stays unchanged. · {#value-stays}\n",
      "oracle/value/value-stays.test.ts": "export {};\n",
      [malformed]: "export {};\n",
    };
    try {
      for (const [path, text] of Object.entries(inputs)) {
        const file = join(root, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
      }
      const actual = bindingFindings(
        readSnapshot(root, { ...DEFAULT_CONFIG, claimSeparator: "·" }),
      );
      expect(actual).toEqual([
        expect.objectContaining({
          rule: "R3",
          path: malformed,
          debtKey: `R3:test-name:${malformed}`,
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

function inspect(inputs: Readonly<Record<string, string>>, legacyAreas: readonly string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "kit-claim-grammar-"));
  const config: KitConfig = { ...DEFAULT_CONFIG, claimSeparator: "·", legacyAreas };
  try {
    for (const [path, text] of Object.entries(inputs)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    const snapshot = readSnapshot(root, config);
    return { snapshot, findings: bindingFindings(snapshot) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const topic = "# value\n\n- A supplied value stays unchanged. · {#value-stays}\n";
const proof = "import { test, expect } from 'vitest'; test('value', () => expect(7).toBe(7));\n";

test.each([false, true])("module relationships preserve the claim identity, legacy=%s", (legacy) => {
  const actual = claimInventory(
    "- A decline needs a reason. · {#decline-needs-reason}\n" +
      "  - Implementation: {{decline}}, {{surface}}\n" +
      "  - Proof: {{decline-cases}}\n",
    { legacy },
  );
  expect(actual).toEqual({
    declarations: [
      {
        anchor: "decline-needs-reason",
        line: 1,
        implementation: ["decline", "surface"],
        proof: ["decline-cases"],
        terms: ["decline", "surface", "decline-cases"],
      },
    ],
    references: [],
  });
});

test.each(["Implementation", "Proof"])("a claim may name only its %s modules", (role) => {
  const actual = claimInventory(
    `- The helper behaves as promised. · {#helper}\n  - ${role}: {{helper}}\n`,
  );
  expect(actual.declarations).toEqual([
    {
      anchor: "helper",
      line: 1,
      terms: ["helper"],
      [role.toLowerCase()]: ["helper"],
    },
  ]);
  expect(actual.references).toEqual([]);
});

test("inline references keep their existing meaning without an inferred relationship", () => {
  expect(claimInventory("- A value stays. {{value}} · {#value-stays}\n").declarations).toEqual([
    { anchor: "value-stays", line: 1, terms: ["value"] },
  ]);
});

test("a claim can have several proofs, including a filename without a variant", () => {
  const actual = inspect({
    "spec/value.md": topic,
    "oracle/value/value-stays.test.ts": proof,
    "oracle/value/value-stays.replay.test.ts": proof,
  });
  expect(actual.snapshot.claims?.map((claim) => claim.anchor)).toEqual(["value-stays"]);
  expect(actual.findings).toEqual([]);
});

test("a claim without proof is reported", () => {
  expect(inspect({ "spec/value.md": topic }).findings).toEqual([
    expect.objectContaining({ debtKey: "R3:missing-proof:spec/value.md:value-stays" }),
  ]);
});

test("a heading's closing marker declares its claim", () => {
  const actual = inspect({
    "spec/value.md": "# value\n\n### The supplied value stays unchanged · {#heading-value}\n",
    "oracle/value/heading-value.test.ts": proof,
  });
  expect(actual.snapshot.claims?.map((claim) => claim.anchor)).toEqual(["heading-value"]);
  expect(actual.findings).toEqual([]);
});

test("a proof cannot name an unknown claim or borrow a claim from another topic", () => {
  const actual = inspect({
    "spec/value.md": topic,
    "oracle/value/value-stays.test.ts": proof,
    "oracle/value/unknown.test.ts": proof,
    "oracle/other/value-stays.test.ts": proof,
  });
  expect(actual.findings.map((finding) => finding.debtKey).sort()).toEqual([
    "R3:unknown-claim:oracle/other/value-stays.test.ts",
    "R3:unknown-claim:oracle/value/unknown.test.ts",
  ]);
});

test("duplicate declaration homes are rejected rather than merged", () => {
  const actual = inspect({
    "spec/value.md": topic,
    "spec/other.md": topic,
    "oracle/value/value-stays.test.ts": proof,
    "oracle/other/value-stays.test.ts": proof,
  });
  expect(actual.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: "R3:duplicate-claim:value-stays" }),
    ]),
  );
});

test("repeating a claim in one topic is rejected even when its module is shared", () => {
  const actual = inspect({
    "spec/value.md": `${topic}\n- A second declaration. {{value}} · {#value-stays}\n`,
    "spec/printing.md": "# Printing\n\n- Printing keeps the value. {{value}} · {#printing-keeps-value}\n",
    "oracle/printing/printing-keeps-value.test.ts": proof,
    "spec/terms.md":
      "- **value** — A supplied value.\n  - Role: fact\n  - Zone: core\n  - Of: []\n",
    "src/core/primitives/value.ts": "export interface Value { readonly label: string }\n",
    "oracle/value/value-stays.test.ts": proof,
  });
  expect(actual.findings).toEqual([
    expect.objectContaining({ debtKey: "R3:duplicate-claim:value-stays" }),
  ]);
});

test.each([
  "The behavior follows {#value-stays}, which is declared above.",
  "The behavior follows\n{#value-stays}, which is declared above.",
  "The behavior follows {#value-stays}.\nIt is declared above.",
  "The behavior follows\n{#value-stays}",
  "The behavior follows ·\n{#value-stays}",
])("paragraph reflow does not turn a reference into a declaration: %s", (reference) => {
  const actual = inspect({
    "spec/value.md": `${topic}\n${reference}\n`,
    "oracle/value/value-stays.test.ts": proof,
  });
  expect(actual.snapshot.claims?.map((claim) => claim.anchor)).toEqual(["value-stays"]);
  expect(actual.findings).toEqual([]);
});

test("code spans and fenced examples cannot declare claims", () => {
  const actual = inspect({
    "spec/value.md": `${topic}\n- A sample: \`· {#sample-only}\`\n\n\`\`\`md\n- A sample. · {#fenced-only}\n\`\`\`\n`,
    "oracle/value/value-stays.test.ts": proof,
  });
  expect(actual.snapshot.claims?.map((claim) => claim.anchor)).toEqual(["value-stays"]);
  expect(actual.findings).toEqual([]);
});

test("a marker belongs to its nested list item, not the surrounding parent item", () => {
  const actual = inspect({
    "spec/value.md":
      "# value\n\n- Parent explanation.\n  - The supplied value stays unchanged. · {#nested-value}\n  - More explanation follows.\n",
    "oracle/value/nested-value.test.ts": proof,
  });
  expect(actual.snapshot.claims?.map((claim) => claim.anchor)).toEqual(["nested-value"]);
  expect(actual.findings).toEqual([]);
});

test("a marker in an earlier paragraph of a list item is a reference, not its closing declaration", () => {
  const actual = inspect({
    "spec/value.md": `${topic}\n- This item references · {#value-stays}\n\n  Its explanation continues in a second paragraph.\n`,
    "oracle/value/value-stays.test.ts": proof,
  });
  expect(actual.snapshot.claims?.map((claim) => claim.anchor)).toEqual(["value-stays"]);
  expect(actual.findings).toEqual([]);
});

test("historical law headings declare claims only in explicitly configured legacy area files", () => {
  const actual = inspect(
    {
      "spec/old.md": "### law · kept-law\n\nThe legacy claim remains.\n",
      "spec/other.md": "### law · not-legacy\n\nThis is not a declaration.\n",
      "oracle/old/kept-law.test.ts": proof,
    },
    ["spec/old.md"],
  );
  expect(actual.snapshot.claims?.map((claim) => claim.anchor)).toEqual(["kept-law"]);
  expect(actual.findings).toEqual([]);
});
