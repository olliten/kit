import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

// The natives a callable handed from probe.ts to the core carries, by type name.
function carried(files: Readonly<Record<string, string>>): string[] {
  const root = mkdtempSync(join(tmpdir(), "kit-captures-"));
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
        },
        include: ["src/**/*.ts"],
      }),
      "src/core/compositions/run.ts":
        "export function run(read: () => unknown): unknown { return read(); }\n" +
        "export function runAll(input: { readonly inner: { readonly reads: readonly (() => unknown)[] } }): unknown[] {\n" +
        "  return input.inner.reads.map((read) => read());\n}\n",
      "src/core/readings/value.ts": "export function value(): number { return 7; }\n",
      // The shell may hold these natives, so only a callable handed to the core is charged them.
      "src/shell/adapters/host.ts":
        "export interface Host { readonly window: Window; readonly document: Document; readonly location: Location; " +
        "readonly response: Response; readonly controller: AbortController; readonly element: HTMLElement; }\n" +
        "export declare const host: Host;\n",
      "src/shell/compositions/fetch-text.ts":
        "export function fetchText(url: string): Promise<string> { return fetch(url).then((response) => response.text()); }\n",
      ...files,
    };
    for (const [path, content] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const snapshot = readSnapshot(root, {
      ...DEFAULT_CONFIG,
      adapters: [
        {
          module: "shell/adapters/host",
          export: "host",
          capability: "host",
          kind: "external",
          zones: ["shell"],
          contract: { type: "Host" },
        },
      ],
    });
    expect(
      snapshot.compiler?.projects
        .flatMap((project) => project.diagnostics)
        .filter((diagnostic) => diagnostic.category === "error"),
    ).toEqual([]);
    return [
      ...new Set(
        capabilityCheck(snapshot)
          .findings.filter(
            (finding) =>
              finding.debtKey.startsWith(
                "R1:native-authority:src/shell/compositions/probe.ts:src/core/compositions/run.ts:",
              ),
          )
          .map((finding) => finding.debtKey.replace(/^.*:/, "")),
      ),
    ].sort();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const run = "import { run, runAll } from '../../core/compositions/run.js';\n";
const probe = (text: string) => ({ "src/shell/compositions/probe.ts": `${run}${text}` });

test("a closure capturing window carries what it calls through it", () => {
  expect(carried(probe("export const result = run(() => window.location.replace('/out'));\n"))).toContain(
    "Location",
  );
});

test("a closure carries a native reached through a helper two imports away", () => {
  expect(
    carried({
      "src/shell/compositions/hop.ts":
        "import { fetchText } from './fetch-text.js';\nexport function load(): Promise<string> { return fetchText('/a'); }\n",
      ...probe("import { load } from './hop.js';\nexport const result = run(() => load());\n"),
    }),
  ).toContain("Response");
});

test("a closure carries a native handle held by a module-level variable it captures", () => {
  expect(
    carried(probe("const controller = new AbortController();\nexport const result = run(() => controller);\n")),
  ).toContain("AbortController");
});

test("a closure carries a native it creates and returns", () => {
  expect(carried(probe("export const result = run(() => new AbortController());\n"))).toContain(
    "AbortController",
  );
});

test("a method reference carries the native its object holds", () => {
  expect(
    carried(
      probe(
        "const holder = { element: document.body, read(): string | null { return this.element.textContent; } };\n" +
          "export const result = run(holder.read);\n",
      ),
    ),
  ).toContain("HTMLElement");
});

test("a bound function carries the native it is bound to", () => {
  expect(
    carried(
      probe(
        "function reload(target: Window): void { target.location.reload(); }\n" +
          "export const result = run(reload.bind(null, window));\n",
      ),
    ),
  ).toContain("Window");
});

test("a closure passed through an object property and an array element keeps its native", () => {
  expect(
    carried(
      probe(
        "const input = { inner: { reads: [() => window.location.href] } };\nexport const result = runAll(input);\n",
      ),
    ),
  ).toContain("Window");
});

test("a closure calling a captured object's method carries that method's native", () => {
  expect(
    carried(
      probe(
        "const navigation = { go(): void { location.assign('/'); } };\nexport const result = run(() => navigation.go());\n",
      ),
    ),
  ).toContain("Location");
});

test("a closure returned from a function carries what that function captured", () => {
  expect(
    carried(
      probe(
        "function make(): () => string { const target = window; return () => target.location.href; }\n" +
          "export const result = run(make());\n",
      ),
    ),
  ).toContain("Window");
});

test("a getter reached through a class instance and this carries the class's native", () => {
  expect(
    carried(
      probe(
        "class Box { element = document.body; get text(): string | null { return this.element.textContent; } }\n" +
          "const box = new Box();\nexport const result = run(() => box.text);\n",
      ),
    ),
  ).toContain("HTMLElement");
});

test("a default export reached through a re-export keeps its native", () => {
  expect(
    carried({
      "src/shell/compositions/loader.ts":
        "export default function (): Promise<string> { return fetch('/').then((response) => response.text()); }\n",
      "src/shell/compositions/loaders.ts": "export { default as load } from './loader.js';\n",
      ...probe("import { load } from './loaders.js';\nexport const result = run(() => load());\n"),
    }),
  ).toContain("Response");
});

test("a handle stored later into a captured mutable binding is carried", () => {
  expect(
    carried(
      probe(
        "let held: unknown = null;\n" +
          "export function keep(): void { held = document; }\n" +
          "export const result = run(() => held);\n",
      ),
    ),
  ).toContain("Document");
});

test("a handle a method call stores into a captured collection is carried", () => {
  expect(
    carried(
      probe(
        "const kept = new Map<string, unknown>();\n" +
          "export function keep(): void { kept.set('page', document); }\n" +
          "export const result = run(() => kept.get('page'));\n",
      ),
    ),
  ).toContain("Document");
});

test("a handle the enclosing function writes into a captured argument is carried", () => {
  expect(
    carried(
      probe(
        "export function wire(state: { held: unknown }): unknown {\n" +
          "  state.held = document;\n  return run(() => state.held);\n}\n",
      ),
    ),
  ).toContain("Document");
});

test("a handle passed to a function of the same file reaches a closure that captures its parameter", () => {
  expect(
    carried(
      probe(
        "let held: (() => unknown) | null = null;\n" +
          "function keep(element: HTMLElement): void { held = () => element; }\n" +
          "keep(document.body);\n" +
          "export const result = run(() => held?.());\n",
      ),
    ),
  ).toContain("HTMLElement");
});

test("a closure in a file whose cone has natives carries none when it captures only pure code", () => {
  expect(
    carried(
      probe(
        "import { fetchText } from './fetch-text.js';\nimport { value } from '../../core/readings/value.js';\n" +
          "export const load = (): Promise<string> => fetchText('/a');\n" +
          "const element = document.body;\nexport const shown = (): string | null => element.textContent;\n" +
          "export const result = run(() => value() + 1);\n",
      ),
    ),
  ).toEqual([]);
});
