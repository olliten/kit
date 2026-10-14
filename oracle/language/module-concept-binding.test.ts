import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { termInventory } from "../../src/core/readings/term-inventory.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("an adopted placed source needs a module concept even without a term declaration", () => {
  const { result } = inspect({ "src/core/primitives/value.ts": valueSource }, "# Terms\n");
  expect(result.findings.map((finding) => finding.debtKey)).toEqual([
    "R3:term-module:src/core/primitives/value.ts:missing-owner",
  ]);
  expect(result.limits).toEqual([]);
});

test.each([
  "- **value** — A meaning without a module role.\n",
  "- **value** — Plain text.\n  - Plain: string\n",
])("non-module metadata cannot own a placed source: %s", (terms) => {
  const { result } = inspect({ "src/core/primitives/value.ts": valueSource }, terms);
  expect(result.findings.map((finding) => finding.debtKey)).toContain(
    "R3:term-module:src/core/primitives/value.ts:missing-owner",
  );
});

test("a field declaration cannot own the otherwise undeclared same-named module", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/field.ts": "export interface Field { readonly text: string }\n",
      "src/core/primitives/model.ts":
        "import type { Value } from './value.js';\nexport interface Model { readonly value: Value | undefined }\n",
    },
    fieldTerms,
  );
  expect(result.findings.map((finding) => finding.debtKey)).toEqual([
    "R3:term-module:src/core/primitives/field.ts:missing-owner",
  ]);
});

test("a supporting exported schema does not require glossary fragments or another module", () => {
  const { result, snapshot } = inspect(
    {
      "src/core/primitives/term.ts":
        "export interface SpecTerm { readonly term: string }\nexport interface TermSyntaxIssue { readonly line: number; readonly detail: string }\n",
    },
    moduleTerm("term", "fact"),
  );
  expect(snapshot.symbols.map((symbol) => symbol.name)).toContain("TermSyntaxIssue");
  expect(snapshot.terms.map((term) => term.term)).toEqual(["term"]);
  expect(result).toEqual({ findings: [], limits: [] });
});

test("a resolved external declaration is not a local owner and still needs package authority evidence", () => {
  const { result, snapshot } = inspect(
    {
      "src/core/readings/read.ts":
        "import { consume } from 'example-package';\nexport function read(value: string): string { return consume(value); }\n",
      "node_modules/example-package/package.json": JSON.stringify({
        name: "example-package",
        type: "module",
        types: "index.d.ts",
      }),
      "node_modules/example-package/index.d.ts":
        "export declare function consume(value: string): string;\n",
    },
    moduleTerm("read", "derived"),
  );
  const edge = snapshot.compiler?.projects
    .flatMap((project) => project.imports)
    .find((edge) => edge.specifier === "example-package");
  expect(edge?.target).toContain("node_modules/example-package/index.d.ts");
  expect(result).toEqual({ findings: [], limits: [] });
  expect(capabilityCheck(snapshot).findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining(":external-boundary:"),
        status: "unresolved",
      }),
    ]),
  );
});

test("a local owner outside src remains an undeclared owner through a TypeScript path alias", () => {
  const root = mkdtempSync(join(tmpdir(), "term-model-local-alias-"));
  roots.push(root);
  const files = {
    "src/core/readings/read.ts": "export type { Value } from '@local/value';\n",
    "helpers/value.ts": valueSource,
    "spec/terms.md": moduleTerm("read", "derived"),
    "spec/prototype.md": "### core/readings/read\nThe local imported owner.\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: [],
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "@local/*": ["helpers/*"] },
      },
      include: ["src/**/*.ts", "helpers/**/*.ts"],
    }),
  };
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const snapshot = readSnapshot(root, DEFAULT_CONFIG);
  expect(snapshot.files).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: "helpers/value.ts", type: "source" })]),
  );
  const result = termModel(snapshot);
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining(":term-source:"),
        path: "src/core/readings/read.ts",
      }),
    ]),
  );
  expect(
    result.findings.some((finding) => finding.debtKey.includes("term-module:helpers/value.ts")),
  ).toBe(false);
});

function moduleTerm(name: string, role: string, references = "[]", zone = "core"): string {
  return `- **${name}** — The ${name} contract.\n  - Role: ${role}\n  - Zone: ${zone}\n  - ${role === "derived" ? "From" : "Of"}: ${references}\n`;
}

test("a declared legacy source satisfies ownership without inventing a placed term", () => {
  const { result } = inspect(
    {
      "src/core/legacy/value.ts": "export const value = 1;\n",
      "src/core/readings/read.ts":
        "import { value } from '../legacy/value.js';\nexport function read() { return value; }\n",
    },
    moduleTerm("read", "derived", "`src/core/legacy/value.ts`"),
  );
  expect(result).toEqual({ findings: [], limits: [] });
});

test.each(["[]", "`src/core/legacy/missing.ts`", "`src/core/legacy/other.ts`"])(
  "an undeclared, missing or different legacy owner cannot hide an import: %s",
  (reference) => {
    const { result } = inspect(
      {
        "src/core/legacy/value.ts": "export const value = 1;\n",
        "src/core/legacy/other.ts": "export const other = 2;\n",
        "src/core/readings/read.ts":
          "import { value } from '../legacy/value.js';\nexport function read() { return value; }\n",
      },
      moduleTerm("read", "derived", reference),
    );
    expect(checks(result)).toContain("term-source");
    if (reference !== "[]") expect(checks(result)).toContain("term-legacy-source");
  },
);

test("a placed source still binds through its global term, never a legacy path", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/readings/read.ts":
        "import type { Value } from '../primitives/value.js';\nexport function read(value: Value) { return value.label; }\n",
    },
    moduleTerm("value", "fact") + moduleTerm("read", "derived", "`src/core/primitives/value.ts`"),
  );
  expect(checks(result)).toContain("term-legacy-source");
  expect(checks(result)).toContain("term-source");
});

test("declaring a legacy path grants no clock capability to a core reading", () => {
  const { snapshot, result } = inspect(
    {
      "src/core/legacy/value.ts": "export function value() { return Date.now(); }\n",
      "src/core/readings/read.ts":
        "import { value } from '../legacy/value.js';\nexport function read() { return value(); }\n",
    },
    moduleTerm("read", "derived", "`src/core/legacy/value.ts`"),
  );
  expect(result).toEqual({ findings: [], limits: [] });
  expect(
    capabilityCheck(snapshot).findings.some(
      (item) => item.path === "src/core/readings/read.ts" && item.status === "violation",
    ),
  ).toBe(true);
});

function inspect(files: Readonly<Record<string, string>>, terms: string) {
  const root = mkdtempSync(join(tmpdir(), "term-model-proof-"));
  roots.push(root);
  const paths = {
    ...files,
    "spec/terms.md": terms,
    "spec/prototype.md": Object.keys(files)
      .filter((path) => path.startsWith("src/") && path.endsWith(".ts"))
      .map((path) => `### ${path.slice(4, -3)}\nThe supplied contract.`)
      .join("\n\n"),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: [],
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
  };
  for (const [path, text] of Object.entries(paths)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const snapshot = readSnapshot(root, DEFAULT_CONFIG);
  return { snapshot, result: termModel(snapshot) };
}

const fieldTerms =
  moduleTerm("value", "fact") +
  moduleTerm("model", "fact", "{{field}}") +
  "- **field** — The selected accepted value.\n  - Field: model::Model.value\n  - Type: value::Value | undefined\n";
const valueSource = "export interface Value { readonly label: string }\n";
function fieldFixture(annotation = "Value | undefined", extra = "", reference = "./value.js") {
  return inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/model.ts": `import type { Value } from '${reference}';\n${extra}\nexport interface Model { readonly value: ${annotation}; readonly helper: string }\n`,
    },
    fieldTerms,
  );
}
function checks(result: ReturnType<typeof termModel>): string[] {
  return result.findings.map((finding) => finding.debtKey.split(":")[1] ?? "");
}

test("Markdown metadata retains meanings, retired words, positions and one declaration alternative", () => {
  const result = termInventory(
    "# Terms\n\n- **value** — The public value. Retired: old.\n  - Role: fact\n  - Zone: core\n  - Of: []\n\n- **reading** — The derived value.\n  - Role: derived\n  - Zone: core\n  - From: {{value}}\n\n- **label** — Plain draft text.\n  - Plain: string\n",
  );
  expect(result.issues).toEqual([]);
  expect(result.terms).toHaveLength(3);
  expect(result.terms[0]).toMatchObject({
    term: "value",
    line: 3,
    retired: ["old"],
    metadata: { kind: "module", role: "fact", zone: "core", references: [] },
  });
  expect(result.terms[0]?.meaning).toContain("public value");
  expect(result.terms[1]?.metadata).toEqual({
    kind: "module",
    role: "derived",
    zone: "core",
    references: ["value"],
  });
  expect(result.terms[2]?.metadata).toEqual({ kind: "plain", scalar: "string" });
});

test("literal fenced, inline and escaped examples do not declare metadata", () => {
  const text =
    "```md\n- **fake** — Not a declaration.\n  - Role: fact\n  - Zone: core\n  - Of: []\n```\n\n`- **inline** — Not a declaration.`\n\n\\- **escaped** — Not a declaration.\n\n- **ordinary** — A meaning-only term.\n";
  const result = termInventory(text);
  expect(result.issues).toEqual([]);
  expect(result.terms.map((term) => term.term)).toEqual(["ordinary"]);
  expect(result.terms[0]?.metadata).toBeUndefined();
});

test.each([
  "  - Role: fact\n  - Role: fact\n  - Zone: core\n  - Of: []",
  "  - Role: fact\n  - Zone: core\n  - Of: []\n  - Plain: string",
  "  - Role: fact\n  - Zone: core\n  - Of: []\n  - Mystery: yes",
  "  - Role: data\n  - Zone: core\n  - Of: []",
  "  - Role: fact\n  - Zone: browser\n  - Of: []",
  "  - Role: fact\n  - Of: []",
  "  - Role: derived\n  - Zone: core\n  - Of: []",
  "  - Field: model::Model.value\n  - Type: value::Value | number",
])("unsupported or contradictory metadata is a declaration finding: %s", (metadata) => {
  const result = termInventory(`- **value** — A value.\n${metadata}\n`);
  const normalized = termModel({
    ...snapshotOf({}),
    terms: result.terms,
    termSyntax: result.issues,
  });
  expect(
    normalized.findings.some((finding) => finding.debtKey.includes(":term-declaration:")),
  ).toBe(true);
});

test("facts may contain schemas and readonly literal constants without fabricated values", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts":
        "export interface Value { readonly text: string }\nexport const LABELS = ['one', 'two'] as const;\n",
    },
    moduleTerm("value", "fact"),
  );
  expect(result.findings).toEqual([]);
  expect(result.limits).toEqual([]);
});

test("a fact may reuse an imported data constant without duplicating its value", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": "export const VALUE = ['one'] as const;\n",
      "src/core/primitives/labels.ts":
        "import { VALUE } from './value.js';\nexport const LABELS = VALUE;\n",
    },
    moduleTerm("value", "fact") + moduleTerm("labels", "fact", "{{value}}"),
  );
  expect(result.findings).toEqual([]);
  expect(result.limits).toEqual([]);
});

test("an imported function alias does not become a data constant", () => {
  const { result } = inspect(
    {
      "src/core/compositions/producer.ts": "export function make(): string { return 'one'; }\n",
      "src/core/primitives/labels.ts":
        "import { make } from '../compositions/producer.js';\nexport const LABELS = make;\n",
    },
    moduleTerm("producer", "composition") + moduleTerm("labels", "fact", "{{producer}}"),
  );
  expect(
    result.findings.some(
      (finding) =>
        finding.path === "src/core/primitives/labels.ts" && finding.debtKey.includes(":term-fact:"),
    ),
  ).toBe(true);
});

test.each([
  "export function parse(value: string): string { return value.trim(); }",
  "export const stamp = Date.now();",
  "export const value = 1 + 2;",
])("executable content cannot claim a fact role: %s", (source) => {
  const { result } = inspect(
    { "src/core/primitives/value.ts": source },
    moduleTerm("value", "fact"),
  );
  expect(checks(result)).toContain("term-fact");
});

test.each(["runtime", "type-only"])("From covers actual direct %s imported owners", (mode) => {
  const files = {
    "src/core/primitives/value.ts":
      "export interface Value { readonly text: string }\nexport const VALUE = 'ok';\n",
    "src/core/readings/read.ts":
      mode === "runtime"
        ? "import { VALUE } from '../primitives/value.js';\nexport function read(): string { return VALUE; }\n"
        : "import type { Value } from '../primitives/value.js';\nexport function read(value: Value): string { return value.text; }\n",
  };
  const allowed = inspect(
    files,
    moduleTerm("value", "fact") + moduleTerm("read", "derived", "{{value}}"),
  );
  expect(allowed.result.findings).toEqual([]);
  const omitted = inspect(files, moduleTerm("value", "fact") + moduleTerm("read", "derived"));
  expect(checks(omitted.result)).toContain("term-source");
});

test("re-exported support types retain their real direct imported owner", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/readings/read.ts": "export type { Value } from '../primitives/value.js';\n",
    },
    moduleTerm("value", "fact") + moduleTerm("read", "derived"),
  );
  expect(checks(result)).toContain("term-source");
});

test("a reading's field reference does not conceal a direct imported type owner", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/model.ts":
        "import type { Value } from './value.js';\nexport interface Model { readonly value: Value | undefined }\n",
      "src/core/readings/read.ts":
        "import type { Value } from '../primitives/value.js';\nexport function read(value: Value): string { return value.label; }\n",
    },
    fieldTerms + moduleTerm("read", "derived", "{{field}}"),
  );
  expect(checks(result)).toContain("term-source");
});

test("selected named fields allow declared absence and leave helper fields unclassified", () => {
  const { snapshot, result } = fieldFixture();
  expect(snapshot.terms.filter((term) => term.metadata?.kind === "module")).toHaveLength(2);
  expect(result.findings).toEqual([]);
  expect(result.limits).toEqual([]);
});

test.each(["Value | undefined | null", "Value | undefined | number", "string | undefined"])(
  "a selected field rejects undeclared absence or another type: %s",
  (annotation) => {
    expect(checks(fieldFixture(annotation).result)).toContain("term-field");
  },
);

test("a supported alias keeps the selected declaration owner", () => {
  expect(fieldFixture("Alias | undefined", "type Alias = Value;").result).toEqual({
    findings: [],
    limits: [],
  });
});

test("a missing selected property is a field finding", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/model.ts":
        "import type { Value } from './value.js';\nexport interface Model { readonly value: Value | undefined }\n",
    },
    fieldTerms.replace("model::Model.value", "model::Model.absent"),
  );
  expect(checks(result)).toContain("term-field");
});

test("a declared named type owner needs a real source home", () => {
  const { result } = inspect(
    {
      "src/core/primitives/model.ts":
        "import type { Value } from './value.js';\nexport interface Model { readonly value: Value | undefined }\n",
    },
    fieldTerms,
  );
  expect(checks(result)).toContain("term-home");
});

test("an extracted constant-only owner missing its named schema is a field violation", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": "export const VALUE = 'one';\n",
      "src/core/primitives/model.ts": "export interface Model { readonly value: string }\n",
    },
    fieldTerms,
  );
  expect(checks(result)).toContain("term-field");
  expect(result.limits).toEqual([]);
});

test("canonical and inflected source homes cannot both own one declared module", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/values.ts": valueSource,
    },
    moduleTerm("value", "fact"),
  );
  expect(checks(result)).toContain("term-home");
});

test("one accepted inflected source home resolves without a concept rename", () => {
  const { result } = inspect(
    { "src/core/primitives/values.ts": valueSource },
    moduleTerm("value", "fact"),
  );
  expect(result.findings).toEqual([]);
  expect(result.limits).toEqual([]);
});

test("global terms preserve punctuation while references ignore case and repeated spaces", () => {
  const terms =
    fieldTerms.replace("{{field}}", "{{FIELD   NAME}}").replace("**field**", "**field name**") +
    "- **field-name** — A distinct ordinary term.\n";
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/model.ts":
        "import type { Value } from './value.js';\nexport interface Model { readonly value: Value | undefined }\n",
    },
    terms,
  );
  expect(result.findings).toEqual([]);
  expect(result.limits).toEqual([]);
});

test("a hyphenated reference cannot silently resolve a spaced global term", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/model.ts":
        "import type { Value } from './value.js';\nexport interface Model { readonly value: Value | undefined }\n",
    },
    fieldTerms.replace("{{field}}", "{{field-name}}").replace("**field**", "**field name**"),
  );
  expect(checks(result)).toContain("term-reference");
});

test("distinct explicit module terms cannot silently share one kebab source home", () => {
  const { result } = inspect(
    { "src/core/primitives/some-thing.ts": valueSource },
    moduleTerm("some thing", "fact") + moduleTerm("some-thing", "fact"),
  );
  expect(result.findings).toHaveLength(1);
  expect(checks(result)).toEqual(["term-home"]);
  expect(result.findings[0]?.path).toBe("src/core/primitives/some-thing.ts");
});

test("a structurally identical same-named foreign type does not acquire the selected identity", () => {
  const { result } = inspect(
    {
      "src/core/primitives/value.ts": valueSource,
      "src/core/primitives/foreign.ts": valueSource,
      "src/core/primitives/model.ts":
        "import type { Value } from './foreign.js';\nexport interface Model { readonly value: Value | undefined }\n",
    },
    fieldTerms.replace("{{field}}", "{{field}}, {{foreign}}") + moduleTerm("foreign", "fact"),
  );
  expect(checks(result)).toContain("term-field");
});

test("unsupported generic annotations remain limits, never an accepted field identity", () => {
  const result = fieldFixture("Readonly<Value> | undefined").result;
  expect(result.limits.some((finding) => finding.debtKey.includes(":term-type-limit:"))).toBe(true);
});

test("the same checker binds the actual Kit Snapshot.config declaration", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const owners = [
    "claim",
    "comment",
    "compiler-facts",
    "default-config",
    "exported-symbol",
    "file",
    "import",
    "module",
    "reference",
    "term",
  ];
  const snapshotSource = readFileSync(join(root, "src/core/primitives/snapshot.ts"), "utf8");
  const files: Record<string, string> = { "src/core/primitives/snapshot.ts": snapshotSource };
  for (const owner of owners) {
    const path = `src/core/primitives/${owner}.ts`;
    files[path] = readFileSync(join(root, path), "utf8");
  }
  const terms =
    owners.map((owner) => moduleTerm(owner, "fact")).join("") +
    moduleTerm(
      "snapshot",
      "fact",
      "{{config}}, {{claim}}, {{comment}}, {{compiler-facts}}, {{exported-symbol}}, {{file}}, {{import}}, {{module}}, {{reference}}, {{term}}",
    ) +
    "- **config** — The chosen configuration.\n  - Field: snapshot::Snapshot.config\n  - Type: default-config::KitConfig\n";
  const good = inspect(files, terms).result;
  expect(good.findings).toEqual([]);
  expect(good.limits).toEqual([]);
  const wrong = inspect(
    {
      ...files,
      "src/core/primitives/snapshot.ts": snapshotSource.replace(
        "readonly config: KitConfig;",
        "readonly config: string;",
      ),
    },
    terms,
  ).result;
  expect(checks(wrong)).toContain("term-field");
});

test("selected union slots bind without field modules while a legacy owner remains undeclared", () => {
  const source =
    "import type { Value } from '../legacy/value.js';\n" +
    "export type Bound = Value | number;\n" +
    "export interface Model { readonly first: Bound | undefined; readonly second: Bound | undefined }\n";
  const value = "export interface Value { readonly text: string }\n";
  const terms =
    moduleTerm("model", "fact") +
    "- **first** — The first selected slot.\n  - Field: model::Model.first\n  - Type: model::Bound | undefined\n" +
    "- **second** — The second selected slot.\n  - Field: model::Model.second\n  - Type: model::Bound | undefined\n";
  const { result } = inspect(
    { "src/core/primitives/model.ts": source, "src/core/legacy/value.ts": value },
    terms,
  );
  expect(checks(result)).not.toContain("term-field");
  expect(result.limits.filter((finding) => finding.debtKey.includes(":term-type-limit:"))).toEqual(
    [],
  );
  // The undeclared legacy owner's import is assessed separately from the selected slot types.
  expect(checks(result)).toContain("term-source");
});
