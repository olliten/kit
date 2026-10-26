import { expect, test } from "vitest";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { capabilityCheck } from "../../src/core/compositions/capability-check.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { semanticReferences } from "../../src/core/readings/semantic-references.js";
import { termInventory } from "../../src/core/readings/term-inventory.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { bindingFindings } from "../core/readings/binding-findings.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const declaration = (name: string, role = "derived", zone = "core", owners = "[]") =>
  `- **${name}** — The ${name} concept.\n  - Role: ${role}\n  - Zone: ${zone}\n  - ${role === "derived" ? "From" : "Of"}: ${owners}\n`;

function evidence(documents: Readonly<Record<string, string>>, declarations: string): Snapshot {
  const inventory = termInventory(declarations);
  return {
    ...snapshotOf({
      files: ["src/core/readings/value.ts", "src/core/readings/spare.ts"],
    }),
    terms: inventory.terms,
    termSyntax: inventory.issues,
    prose: Object.entries({ ...documents, "spec/terms.md": declarations }).map(([file, text]) => ({
      file,
      text,
    })),
  };
}

test("two unrelated narratives share one module, and a module no claim names is a finding", () => {
  const base = evidence(
    {
      "spec/planning.md": "# Planning\n\n- Use {{value}} to plan. · {#plan}",
      "spec/printing.md": "# Printing\n\n- Print {{VALUE}}. · {#print}",
    },
    declaration("spare") + declaration("value"),
  );
  const snapshot: Snapshot = {
    ...base,
    files: [...base.files, { path: "oracle/planning/plan.test.ts", type: "test" }, { path: "oracle/printing/print.test.ts", type: "test" }],
    claims: [
      { file: "spec/planning.md", anchor: "plan", line: 3, terms: ["value"] },
      { file: "spec/printing.md", anchor: "print", line: 3, terms: ["VALUE"] },
    ],
  };
  expect(semanticReferences(snapshot).topicModules).toEqual([
    { topic: "spec/planning.md", modules: ["value"] },
    { topic: "spec/printing.md", modules: ["value"] },
  ]);
  expect(termModel(snapshot)).toEqual({ findings: [], limits: [] });
  expect(bindingFindings(snapshot).map((row) => row.debtKey)).toEqual([
    "R4:unreferenced-module:core/readings/spare",
  ]);
});

test("groups sort and deduplicate resolved module names and exclude global From/Of edges", () => {
  const declarations =
    declaration("Value") +
    declaration("spare") +
    declaration("read", "derived", "core", "{{Value}}") +
    declaration("model", "fact", "core", "{{spare}}") +
    "- **label** — Plain label.\n  - Plain: string\n" +
    "- **slot** — A selected field.\n  - Field: model::Model.value\n  - Type: Value::Value\n";
  const documents = {
    "spec/zebra.md":
      "# Zebra\n{{spare}} {{VALUE}} {{Value}} {{label}} {{slot}} [[alpha]] `{{read}}` \\{{model}}",
    "spec/alpha.md": "# Alpha\nNo marked module use.",
  };
  const expected = [
    { topic: "spec/alpha.md", modules: [] },
    { topic: "spec/zebra.md", modules: ["Value", "spare"] },
  ];
  const before = evidence(documents, declarations);
  expect(semanticReferences(before).findings).toEqual([]);
  expect(semanticReferences(before).topicModules).toEqual(expected);
  expect(
    semanticReferences({
      ...before,
      prose: [...before.prose].reverse(),
      terms: [...before.terms].reverse(),
    }).topicModules,
  ).toEqual(expected);
});

test("missing and ambiguous marked terms remain findings and never become group members", () => {
  const snapshot = evidence(
    { "spec/planning.md": "# Planning\n{{missing}} {{value}} {{spare}}" },
    declaration("value") + declaration("VALUE") + declaration("spare"),
  );
  const result = semanticReferences(snapshot);
  expect(result.topicModules).toEqual([{ topic: "spec/planning.md", modules: ["spare"] }]);
  expect(result.findings.map((finding) => finding.debtKey)).toEqual([
    "R3:ambiguous-term-reference:spec/planning.md:value",
    "R3:missing-term-reference:spec/planning.md:missing",
  ]);
});

test("a resolved narrative reference cannot supply a missing source or a mismatched role or zone", () => {
  const snapshot = evidence(
    { "spec/planning.md": "# Planning\n{{value}} {{spare}}" },
    declaration("value") + declaration("spare"),
  );
  for (const declarations of [
    declaration("value") + declaration("spare", "fact"),
    declaration("value") + declaration("spare", "derived", "shell"),
  ]) {
    expect(
      termModel({ ...snapshot, terms: termInventory(declarations).terms }).findings.map(
        (finding) => finding.debtKey,
      ),
    ).toContain("R3:term-home:spare:0");
  }
  expect(
    termModel({
      ...snapshot,
      files: snapshot.files.filter((file) => !file.path.endsWith("spare.ts")),
    }).findings.map((finding) => finding.debtKey),
  ).toEqual(["R3:term-home:spare:0"]);
});

test("regrouping narratives leaves forbidden import permissions and source bindings unchanged", () => {
  const snapshot = evidence(
    { "spec/planning.md": "# Planning\n{{value}}", "spec/printing.md": "# Printing" },
    declaration("value") + declaration("spare"),
  );
  const before: Snapshot = {
    ...snapshot,
    imports: [{ from: "src/core/readings/value.ts", to: "src/substrate/adapters/store.ts" }],
  };
  const after: Snapshot = {
    ...before,
    prose: before.prose.map((entry) =>
      entry.file === "spec/planning.md"
        ? { ...entry, text: "# Planning" }
        : entry.file === "spec/printing.md"
          ? { ...entry, text: "# Printing\n{{value}}" }
          : entry,
    ),
  };
  expect(semanticReferences(before).topicModules).not.toEqual(
    semanticReferences(after).topicModules,
  );
  expect(dependencyCheck(before)).not.toEqual([]);
  expect(dependencyCheck(after)).toEqual(dependencyCheck(before));
  expect(capabilityCheck(after)).toEqual(capabilityCheck(before));
  expect(termModel(after)).toEqual(termModel(before));
  expect(bindingFindings(after)).toEqual(bindingFindings(before));
});
