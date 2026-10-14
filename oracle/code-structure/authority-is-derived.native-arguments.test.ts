import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

function inspect(
  files: Readonly<Record<string, string>>,
  extraAdapters: NonNullable<KitConfig["adapters"]> = [],
  adapterDirectory: "adapters" | "ports" = "adapters",
) {
  const root = mkdtempSync(join(tmpdir(), "kit-native-arguments-"));
  try {
    const inputs = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM"],
          types: [],
          strict: true,
          noEmit: true,
          declaration: true,
          isolatedDeclarations: true,
        },
        include: ["src/**/*.ts"],
      }),
      [`src/substrate/${adapterDirectory}/clock.ts`]:
        "export interface Clock { now(): number; }\nexport const clock: Clock = { now: () => Date.now() };\n",
      [`src/shell/${adapterDirectory}/render.ts`]:
        "export interface Rendering { create(): HTMLElement; paint(element: HTMLElement, view: { readonly text: string }): void; }\n" +
        "export const rendering: Rendering = { create: () => document.createElement('button'), paint: (element, view) => { element.textContent = view.text; } };\n",
      [`src/shell/${adapterDirectory}/focus.ts`]:
        "export interface Focus { to(element: HTMLElement): void; }\n" +
        "export const focus: Focus = { to: (element) => element.focus() };\n",
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const snapshot = readSnapshot(root, {
      ...DEFAULT_CONFIG,
      layerNames: {
        primitives: "primitives",
        readings: "readings",
        adapters: adapterDirectory,
        compositions: "compositions",
      },
      adapters: [
        {
          module: "substrate/adapters/clock",
          export: "clock",
          capability: "clock.read",
          kind: "external",
          zones: ["substrate"],
          contract: { type: "Clock" },
          primitives: ["clock"],
        },
        {
          module: "shell/adapters/render",
          export: "rendering",
          capability: "dom.render",
          kind: "external",
          zones: ["shell"],
          contract: { type: "Rendering" },
          globals: ["document"],
        },
        {
          module: "shell/adapters/focus",
          export: "focus",
          capability: "dom.focus",
          kind: "external",
          zones: ["shell"],
          contract: { type: "Focus" },
        },
        ...extraAdapters,
      ],
    });
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    return capabilityCheck(snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each(["paint", "focus"])(
  "a native control passed to its %s adapter is not a supplied callback",
  (operation) => {
    const result = inspect({
      "src/shell/compositions/view.ts":
        "import { rendering } from '../adapters/render.js';\nimport { focus } from '../adapters/focus.js';\n" +
        `export function view(accepted: () => void): void { const element = rendering.create(); ${operation === "paint" ? "rendering.paint(element, { text: 'text' });" : "focus.to(element);"} }\n`,
    });
    expect(result.findings).toEqual([]);
  },
);

test("an internally created Map of data is not a supplied callback to its private helper", () => {
  const result = inspect({
    "src/core/compositions/value.ts":
      "function first(memo: Map<string, number>): number { return memo.get('value') ?? 0; }\n" +
      "export function value(accepted: () => void): number { const memo = new Map<string, number>(); memo.set('value', 7); return first(memo); }\n",
  });
  expect(result.findings).toEqual([]);
});

test("a mapped adapter directory retains native control argument recognition", () => {
  const result = inspect(
    {
      "src/shell/compositions/view.ts":
        "import { rendering } from '../ports/render.js';\n" +
        "export function view(accepted: () => void): void { const element = rendering.create(); rendering.paint(element, { text: 'text' }); }\n",
    },
    [],
    "ports",
  );
  expect(result.findings).toEqual([]);
});

test.each(["record", "map", "array", "custom-map", "lookalike"])(
  "a %s containing a clock callback cannot enter Core",
  (kind) => {
    const parameter =
      kind === "map"
        ? "Map<string, () => number>"
        : kind === "array"
          ? "ReadonlyArray<() => number>"
          : "{ readonly read: () => number }";
    const body =
      kind === "map"
        ? "return input.get('read')?.() ?? 0;"
        : kind === "array"
          ? "return input[0]?.() ?? 0;"
          : "return input.read();";
    const expression =
      kind === "map"
        ? "new Map([['read', () => clock.now()]])"
        : kind === "array"
          ? "[() => clock.now()]"
          : kind === "custom-map"
            ? "new Reader()"
            : "{ read: () => clock.now() }";
    const result = inspect({
      "src/core/compositions/run.ts": `export function run(input: ${kind === "lookalike" ? "NativeLike" : parameter}): number { ${body} }\n`,
      ...(kind === "lookalike"
        ? { "src/lib.esfake.d.ts": "interface NativeLike { readonly read: () => number; }\n" }
        : {}),
      "src/substrate/compositions/caller.ts":
        "import { run } from '../../core/compositions/run.js';\nimport { clock } from '../adapters/clock.js';\n" +
        (kind === "custom-map"
          ? "class Reader extends Map<string, number> { read(): number { return clock.now(); } }\n"
          : "") +
        `export const result: number = run(${expression});\n`,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ blocking: true })]),
    );
  },
);

test("a directly passed native event handler remains executable input", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(read: (event: PointerEvent) => unknown): unknown { return read(new PointerEvent('click')); }\n",
    "src/shell/compositions/caller.ts":
      "import { run } from '../../core/compositions/run.js';\nimport { rendering } from '../adapters/render.js';\n" +
      "export function call(): unknown { const node = rendering.create(); node.onclick = () => 7; return run(node.onclick); }\n",
  });
  expect(
    result.findings.filter((finding) => /R1:(?:closure|callable)-binding:/.test(finding.debtKey)),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ blocking: true })]));
});

test("a reading still rejects a native DOM parameter", () => {
  const result = inspect({
    "src/core/readings/value.ts":
      "export function value(element: HTMLElement): string { return element.tagName; }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining("R1:reading-callable:"),
        blocking: true,
      }),
    ]),
  );
});

test("native DOM authority cannot enter a Core composition through its control parameter", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(element: HTMLElement): void { element.focus(); }\n",
    "src/shell/compositions/caller.ts":
      "import { run } from '../../core/compositions/run.js';\nimport { rendering } from '../adapters/render.js';\nexport function call(): void { run(rendering.create()); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ blocking: true })]),
  );
});

test("an application getter passed to an adapter retains its clock authority", () => {
  const result = inspect({
    "src/shell/compositions/view.ts":
      "import { rendering } from '../adapters/render.js';\n" +
      "import { clock } from '../../substrate/adapters/clock.js';\n" +
      "export function view(): void { const element = rendering.create(); rendering.paint(element, { get text(): string { return String(clock.now()); } }); }\n",
  });
  expect(
    result.findings.filter((finding) => finding.debtKey.includes("R1:closure-binding:")),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test("registering a Core producer does not make its native control input an external adapter boundary", () => {
  const path = "src/core/compositions/produce.ts";
  const result = inspect(
    {
      [path]:
        "export interface Write { readonly value: number; }\n" +
        "export function produce(element: HTMLElement): Write { element.focus(); return { value: 1 }; }\n",
      "src/shell/compositions/caller.ts":
        "import { produce } from '../../core/compositions/produce.js';\n" +
        "import { rendering } from '../adapters/render.js';\nexport function call(): void { produce(rendering.create()); }\n",
    },
    [
      {
        module: "core/compositions/produce",
        export: "produce",
        capability: "produce-writes",
        kind: "produce",
        zones: ["core"],
        contract: { type: "Write" },
      },
    ],
  );
  expect(
    result.findings.filter(
      (finding) =>
        /R1:(?:closure|callable)-binding:/.test(finding.debtKey) && finding.debtKey.includes(path),
    ),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ blocking: true })]));
});
