import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/compositions/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const adapter = "src/shell/adapters/pdf-render.ts";
const owner: NonNullable<KitConfig["adapters"]>[number] = {
  module: "shell/adapters/pdf-render",
  export: "pdfRender",
  capability: "document-processing",
  kind: "external",
  zones: ["shell"],
  contract: { type: "PdfRender" },
};

function inspect(
  body: string,
  options: {
    readonly imports?: string;
    readonly classified?: boolean;
    readonly files?: Readonly<Record<string, string>>;
    readonly adapters?: NonNullable<KitConfig["adapters"]>;
  } = {},
) {
  const snapshot = sourceFixture(
    {
      "node_modules/pdf-engine/package.json": JSON.stringify({
        name: "pdf-engine", types: "index.d.ts", type: "module",
      }),
      "node_modules/pdf-engine/index.d.ts":
        "export interface Viewport { clone(): Viewport; }\n" +
        "export function viewport(): Viewport;\n" +
        "export class TextLayer { constructor(opts: { viewport: Viewport; read?: () => string }); }\n",
      [adapter]: `${options.imports ?? ""}\n` +
        "interface PdfRender { open(): Promise<unknown>; }\n" +
        `export const pdfRender: PdfRender = { async open() { ${body} } };\n`,
      ...options.files,
    },
    {
      packages: options.classified === false ? [] : [{ name: "pdf-engine", capabilities: ["document-processing"] }],
      adapters: [owner, ...(options.adapters ?? [])],
    },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return { snapshot, result: capabilityCheck(snapshot) };
}

const forms = [
  {
    name: "destructured dynamic import",
    body: 'const engine = await import("pdf-engine"); const { TextLayer } = engine; return new TextLayer({ viewport: engine.viewport() });',
    imports: "",
  },
  {
    name: "direct dynamic member",
    body: 'const engine = await import("pdf-engine"); return new engine.TextLayer({ viewport: engine.viewport() });',
    imports: "",
  },
  {
    name: "static named import",
    body: "return new TextLayer({ viewport: viewport() });",
    imports: 'import { TextLayer, viewport } from "pdf-engine";',
  },
] as const;

test.each(forms)("a classified $name constructor keeps its package capability without unknown caller authority", ({ body, imports }) => {
  const { result } = inspect(body, { imports });
  expect(result.findings).toEqual([]);
  expect(result.requirements.find((row) => row.path === adapter)?.direct).toEqual(["document-processing"]);
});

test.each(forms)("an unclassified $name constructor remains an unresolved package boundary", ({ body, imports }) => {
  const { result } = inspect(body, { imports, classified: false });
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: adapter, status: "unresolved", blocking: true }),
  ]));
});

test("a constructed package value handed to Core as a callable makes the Core module that takes it a finding", () => {
  const { result } = inspect(
    'const engine = await import("pdf-engine"); const { TextLayer } = engine; return run(() => new TextLayer({ viewport: engine.viewport() }));',
    {
      imports: 'import { run } from "../../core/compositions/run.js";',
      files: { "src/core/compositions/run.ts": "export function run(read: () => unknown): unknown { return read(); }" },
    },
  );
  expect(result.findings.map((finding) => finding.debtKey)).toContain("R1:takes-behaviour:src/core/compositions/run.ts:run");
});

test("a Core constructor taking an executable argument is a finding, whatever the argument holds", () => {
  const snapshot = sourceFixture({
    "src/core/compositions/box.ts": "export class Box { constructor(read: () => string) { read(); } }",
    "src/shell/adapters/navigation.ts": "export interface Navigation { readonly href: () => string; } export const navigation: Navigation = { href: () => window.location.href };",
    "src/shell/compositions/run.ts": 'import { navigation } from "../adapters/navigation.js"; import { Box } from "../../core/compositions/box.js"; export function run(): unknown { return new Box(() => navigation.href()); }',
  }, { adapters: [{ module: "shell/adapters/navigation", export: "navigation", capability: "navigation", kind: "external", zones: ["shell"], contract: { type: "Navigation" }, globals: ["window"] }] });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  expect(capabilityCheck(snapshot).findings.map((finding) => finding.debtKey)).toContain("R1:takes-behaviour:src/core/compositions/box.ts:Box");
});

test("a classified constructor accepts an executable argument from checked pure project code", () => {
  const { result } = inspect(
    'const engine = await import("pdf-engine"); const { TextLayer } = engine; return new TextLayer({ viewport: engine.viewport(), read });',
    {
      imports: 'import { read } from "../../core/primitives/text.js";',
      files: { "src/core/primitives/text.ts": 'export function read(): string { return "plain"; }' },
    },
  );
  expect(result.findings).toEqual([]);
});

test("an executable argument from unchecked project code retains its unresolved boundary", () => {
  const { result } = inspect(
    'const engine = await import("pdf-engine"); const { TextLayer } = engine; return new TextLayer({ viewport: engine.viewport(), read });',
    {
      imports: 'import { read } from "../../../outside/read.js";',
      files: { "outside/read.ts": 'export function read(): string { return "unchecked"; }' },
    },
  );
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: adapter, status: "unresolved", blocking: true }),
  ]));
});
