import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const gateSource =
  process.env.KIT_GATE_SOURCE ?? new URL("../../scripts/kit-check.mjs", import.meta.url).href;
const { ratchetFindings } = await import(gateSource);

function inspect(
  files: Readonly<Record<string, string>>,
  extraAdapters: NonNullable<KitConfig["adapters"]> = [],
) {
  const root = mkdtempSync(join(tmpdir(), "kit-registration-data-"));
  const config: KitConfig = {
    ...DEFAULT_CONFIG,
    legacyZones: [{ root: "src/legacy/", zone: "shell" }],
    adapters: [
      {
        module: "shell/adapters/focus",
        export: "focus",
        capability: "dom.focus",
        kind: "external",
        zones: ["shell"],
        contract: { type: "Focus" },
      },
      {
        module: "substrate/adapters/transport",
        export: "transport",
        capability: "transport.request",
        kind: "external",
        zones: ["substrate"],
        contract: { type: "Transport" },
        globals: ["fetch"],
      },
      {
        module: "shell/adapters/clock",
        export: "clock",
        capability: "clock.read",
        kind: "external",
        zones: ["shell"],
        contract: { type: "ShellClock" },
        primitives: ["clock"],
      },
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
        module: "shell/adapters/input",
        export: "input",
        capability: "dom.input",
        kind: "external",
        zones: ["shell"],
        contract: { type: "InputEvents" },
      },
      {
        module: "core/compositions/produce",
        export: "produce",
        capability: "cell.produce",
        kind: "produce",
        zones: ["core"],
      },
      ...extraAdapters,
    ],
  };
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
    "src/substrate/adapters/clock.ts":
      "export interface Clock { now(): number; }\nexport const clock: Clock = { now: () => Date.now() };\n",
    "src/substrate/adapters/transport.ts":
      "export interface Transport { request(): Promise<Response>; }\nexport const transport: Transport = { request: () => fetch('https://example.invalid') };\n",
    "src/shell/adapters/clock.ts":
      "export interface ShellClock { now(): number; }\nexport const clock: ShellClock = { now: () => Date.now() };\n",
    "src/shell/adapters/focus.ts":
      "export interface Focus { to(element: HTMLElement): void; }\nexport const focus: Focus = { to: (element) => { element.focus(); } };\n",
    "src/core/primitives/write.ts": "export interface Write { readonly value: number; }\n",
    "src/core/compositions/produce.ts":
      "import type { Write } from '../primitives/write.js';\nexport function produce(): Write { return { value: 7 }; }\n",
    "src/shell/adapters/input.ts":
      "export interface InputEvents { listen(element: HTMLElement, handler: () => void): void; }\nexport const input: InputEvents = { listen: (element, handler) => { element.addEventListener('click', handler); } };\n",
    ...files,
  };
  try {
    for (const [path, source] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source);
    }
    const snapshot = readSnapshot(root, config);
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    return {
      findings: capabilityCheck(snapshot).findings,
      dependencies: dependencyCheck(snapshot),
      globals: snapshot.compiler?.projects.flatMap((project) => project.globals) ?? [],
      imports: snapshot.imports,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each(["closure", "binding"])(
  "an input adapter registers a permitted producer %s without acquiring construction authority",
  (form) => {
    const handler = form === "closure" ? "() => { produce(); }" : "produce";
    const result = inspect({
      "src/shell/compositions/view.ts":
        "import { produce } from '../../core/compositions/produce.js';\nimport { input } from '../adapters/input.js';\n" +
        `export function view(element: HTMLElement): void { input.listen(element, ${handler}); }\n`,
    });
    expect(result.findings).toEqual([]);
    expect(result.dependencies).toEqual([]);
  },
);

test("an adapter cannot directly import and invoke a Core producer", () => {
  const result = inspect({
    "src/shell/adapters/input.ts":
      "import { produce } from '../../core/compositions/produce.js';\nexport interface InputEvents { listen(element: HTMLElement, handler: () => void): void; }\nexport const input: InputEvents = { listen: (element, handler) => { produce(); element.addEventListener('click', handler); } };\n",
  });
  expect(result.dependencies).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule: "R2", path: "shell/adapters/input" })]),
  );
});

test("a permitting Shell composition can register its clock handler", () => {
  const result = inspect({
    "src/shell/compositions/view.ts":
      "import { clock } from '../adapters/clock.js';\nimport { input } from '../adapters/input.js';\nexport function view(element: HTMLElement): void { input.listen(element, () => { clock.now(); }); }\n",
  });
  expect(result.findings).toEqual([]);
  expect(result.dependencies).toEqual([]);
});

test("a Core caller cannot register a clock handler by forwarding it to an input adapter", () => {
  const result = inspect({
    "src/core/compositions/view.ts":
      "import { clock } from '../../shell/adapters/clock.js';\nimport { input } from '../../shell/adapters/input.js';\nexport function view(element: HTMLElement): void { input.listen(element, () => { clock.now(); }); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/core/compositions/view.ts",
        status: "violation",
      }),
    ]),
  );
});

test("a clock closure still cannot be passed to a Core composition", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(fn: () => number): number { return fn(); }\n",
    "src/substrate/compositions/main.ts":
      "import { clock } from '../adapters/clock.js';\nimport { run } from '../../core/compositions/run.js';\nexport function main(): number { return run(() => clock.now()); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "R1",
        path: "src/substrate/compositions/main.ts",
        status: "violation",
      }),
    ]),
  );
});

test.each(["ReadonlyMap<string, number>", "ReadonlySet<number>"])(
  "a composition's native %s parameter does not turn a pure closure into unknown authority",
  (type) => {
    const result = inspect({
      "src/core/compositions/run.ts":
        "export function run(fn: () => number): number { return fn(); }\n",
      "src/core/compositions/value.ts":
        "import { run } from './run.js';\n" +
        `export function value(data: ${type}): number { return run(() => 7); }\n`,
    });
    expect(result.findings).toEqual([]);
  },
);

test("a reading's public Map, Set or array of data is data, like an array", () => {
  const result = inspect({
    "src/core/readings/total.ts":
      "export function total(values: ReadonlyMap<string, number>): number { let sum = 0; for (const value of values.values()) sum += value; return sum; }\n",
    "src/core/readings/count.ts":
      "export function count(names: ReadonlySet<string>): number { return names.size; }\n",
    "src/core/readings/sum.ts":
      "export function sum(values: readonly number[]): number { return values.reduce((left, right) => left + right, 0); }\n",
    "src/core/readings/first.ts":
      "export function first(values: Map<string, number>, names: Set<string>): number { return names.has('a') ? (values.get('a') ?? 0) : 0; }\n",
  });
  expect(result.findings.filter((finding) => finding.debtKey.includes("reading-callable"))).toEqual(
    [],
  );
});

test.each(["ReadonlyMap<string, () => number>", "ReadonlySet<() => number>"])(
  "a reading's public %s input still carries supplied behaviour",
  (parameter) => {
    const result = inspect({
      "src/core/readings/value.ts": `export function value(data: ${parameter}): number { return 0; }\n`,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: "R1:reading-callable:src/core/readings/value.ts:data",
          status: "violation",
        }),
      ]),
    );
  },
);

test("a Map of clock callbacks still cannot enter Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(data: ReadonlyMap<string, () => number>): number { return data.get('value')?.() ?? 0; }\n",
    "src/substrate/compositions/main.ts":
      "import { clock } from '../adapters/clock.js';\nimport { run } from '../../core/compositions/run.js';\nexport function main(): number { return run(new Map<string, () => number>([['value', () => clock.now()]])); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "R1",
        path: "src/substrate/compositions/main.ts",
        status: "violation",
      }),
    ]),
  );
});

test("a native DOM handle still cannot enter a Core composition", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(element: HTMLElement): void { element.focus(); }\n",
    "src/shell/compositions/view.ts":
      "import { run } from '../../core/compositions/run.js';\nexport function view(element: HTMLElement): void { run(element); }\n",
  });
  expect(result.findings.some((finding) => finding.blocking && finding.rule === "R1")).toBe(true);
});

test("a Shell composition can register a pure handler using native controls", () => {
  const result = inspect({
    "src/shell/compositions/view.ts":
      "import { input } from '../adapters/input.js';\nexport function view(...controls: HTMLElement[]): void { for (const element of controls) input.listen(element, () => {}); }\n",
  });
  expect(result.findings).toEqual([]);
});

test.each(["handle", "options", "rest"])(
  "a native control in a %s argument can reach its permitting Shell composition",
  (shape) => {
    const parameter =
      shape === "handle" || shape === "rest"
        ? "HTMLElement"
        : "{ readonly control: HTMLElement; readonly keyboard: boolean }";
    const argument = shape === "options" ? "{ control: element, keyboard: false }" : "element";
    const result = inspect({
      "src/shell/compositions/open.ts":
        shape === "rest"
          ? "export function open(...value: HTMLElement[]): void { void value; }\n"
          : `export function open(value: ${parameter}): void { void value; }\n`,
      "src/shell/compositions/view.ts":
        "import { open } from './open.js';\n" +
        `export function view(element: HTMLElement): void { open(${argument}); }\n`,
    });
    expect(result.findings).toEqual([]);
    expect(result.dependencies).toEqual([]);
  },
);

test("a native-control record carrying an unknown host callback retains uncertainty", () => {
  const result = inspect({
    "src/shell/compositions/open.ts":
      "export function open(value: { readonly control: HTMLElement; readonly host: () => void }): void { value.host(); }\n",
    "src/shell/compositions/view.ts":
      "import { open } from './open.js';\nexport function view(element: HTMLElement, host: () => void): void { open({ control: element, host }); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "unresolved", blocking: true })]),
  );
});

test("a native DOM handle still cannot cross into a Substrate composition", () => {
  const result = inspect({
    "src/substrate/compositions/open.ts":
      "export function open(element: HTMLElement): void { void element; }\n",
    "src/shell/compositions/view.ts":
      "import { open } from '../../substrate/compositions/open.js';\nexport function view(element: HTMLElement): void { open(element); }\n",
  });
  expect(result.findings.some((finding) => finding.blocking && finding.rule === "R1")).toBe(true);
});

test.each(["private", "method"])(
  "a %s native-data endpoint can supply a callback to its permitting Shell boundary",
  (shape) => {
    const helper =
      shape === "private"
        ? "function forward(control: HTMLElement): void { open(control); }\n"
        : "const host = { forward(control: HTMLElement): void { open(control); } };\n";
    const call = shape === "private" ? "forward(control)" : "host.forward(control)";
    const result = inspect({
      "src/legacy/open.ts": "export function open(control: HTMLElement): void { void control; }\n",
      "src/shell/compositions/run.ts":
        "export function run(read: () => number): number { return read(); }\n",
      "src/legacy/host.ts":
        "import { open } from './open.js';\nimport { run } from '../shell/compositions/run.js';\n" +
        helper +
        `export function main(control: HTMLElement): number { ${call}; return run(() => 7); }\n`,
    });
    expect(result.findings).toEqual([]);
  },
);

test("an unknown executable private endpoint remains explicitly unresolved", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(read: () => number): number { return read(); }\n",
    "src/legacy/host.ts":
      "import { run } from '../core/compositions/run.js';\nfunction forward(read: () => number): number { return run(read); }\nexport function main(read: () => number): number { return forward(read); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "unresolved", blocking: true })]),
  );
  expect(
    ratchetFindings(result.findings, [], ["src/core/compositions/run.ts"], result.imports).length,
  ).toBeGreaterThan(0);
});

test("readonly key data, a native data record and an unused private function parameter do not grant authority", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(read: () => number): number { return read(); }\n",
    "src/legacy/host.ts":
      "import { run } from '../core/compositions/run.js';\ninterface KeyData { readonly key: string; readonly alt: boolean; }\nfunction unused(read: () => number): number { return read(); }\nexport function main(data: KeyData, box: Readonly<DOMRectInit>): number { return run(() => data.alt ? (box.x ?? 0) : 0); }\n",
  });
  expect(result.findings).toEqual([]);
});

test("a private endpoint cannot forward clock authority into Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(read: () => number): number { return read(); }\n",
    "src/legacy/host.ts":
      "import { clock } from '../substrate/adapters/clock.js';\nimport { run } from '../core/compositions/run.js';\nfunction forward(read: () => number): number { return run(read); }\nexport function main(): number { return forward(() => clock.now()); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test("a legacy native-focus closure cannot escape through a bridge into Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
    "src/legacy/creator.ts":
      "export function create(control: HTMLElement): () => void { return () => control.focus(); }\n",
    "src/legacy/bridge.ts": "export { create } from './creator.js';\n",
    "src/shell/compositions/view.ts":
      "import { create } from '../../legacy/bridge.js';\nimport { run } from '../../core/compositions/run.js';\nexport function view(control: HTMLElement): void { run(create(control)); }\n",
  });
  expect(result.findings.some((finding) => finding.blocking && finding.rule === "R1")).toBe(true);
});

test.each(["private", "returned-method"])(
  "a %s native-focus closure cannot escape into Core",
  (shape) => {
    const creator =
      shape === "private"
        ? "function make(control: HTMLElement): () => void { return () => control.focus(); }\nexport function create(control: HTMLElement): () => void { return make(control); }\n"
        : "export function factory(): { create(control: HTMLElement): () => void } { return { create(control: HTMLElement): () => void { return () => control.focus(); } }; }\n";
    const call = shape === "private" ? "create(control)" : "factory().create(control)";
    const name = shape === "private" ? "create" : "factory";
    const result = inspect({
      "src/core/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
      "src/legacy/creator.ts": creator,
      "src/legacy/bridge.ts": `export { ${name} } from './creator.js';\n`,
      "src/shell/compositions/view.ts": `import { ${name} } from '../../legacy/bridge.js';\nimport { run } from '../../core/compositions/run.js';\nexport function view(control: HTMLElement): void { run(${call}); }\n`,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/shell/compositions/view.ts",
          rule: "R1",
          blocking: true,
        }),
      ]),
    );
  },
);

test("a retained method carrying a native focus closure cannot enter Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
    "src/legacy/creator.ts":
      "export function create(control: HTMLElement): { act(): void } { return { act(): void { control.focus(); } }; }\n",
    "src/shell/compositions/view.ts":
      "import { create } from '../../legacy/creator.js';\nimport { run } from '../../core/compositions/run.js';\nexport function view(control: HTMLElement): void { const carrier = create(control); run(carrier.act); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/shell/compositions/view.ts",
        rule: "R1",
        blocking: true,
      }),
    ]),
  );
});

test("a direct legacy native-focus lambda cannot execute inside Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
    "src/legacy/main.ts":
      "import { run } from '../core/compositions/run.js';\nexport function main(control: HTMLElement): void { run(() => control.focus()); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/core/compositions/run.ts", rule: "R1", blocking: true }),
    ]),
  );
  expect(
    ratchetFindings(result.findings, [], ["src/core/compositions/run.ts"], result.imports).length,
  ).toBeGreaterThan(0);
});

test("a Map of native handles still grants authority to a closure sent into Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
    "src/legacy/main.ts":
      "import { run } from '../core/compositions/run.js';\nexport function main(controls: ReadonlyMap<string, HTMLElement>): void { const control = controls.get('control'); if (control !== undefined) run(() => control.focus()); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/core/compositions/run.ts", rule: "R1", blocking: true }),
    ]),
  );
});

test("a native Storage callback cannot acquire browser I/O permission from a focus contract", () => {
  const result = inspect({
    "src/shell/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
    "src/legacy/main.ts":
      "import { run } from '../shell/compositions/run.js';\nexport function main(storage: Storage): void { run(() => storage.clear()); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/shell/compositions/run.ts",
        rule: "R1",
        blocking: true,
      }),
    ]),
  );
});

test("one placed Storage authority cause is reported once at its source module", () => {
  const result = inspect({
    "src/shell/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
    "src/shell/compositions/main.ts":
      "import { run } from './run.js';\nexport function main(storage: Storage): void { run(() => storage.clear()); }\n",
  });
  const causes = result.findings.filter(
    (finding) =>
      finding.path === "src/shell/compositions/main.ts" &&
      finding.debtKey.includes(":native-authority:"),
  );
  expect(causes, causes.map((finding) => finding.debtKey).join("\n")).toHaveLength(1);
  expect(causes[0]).toMatchObject({ blocking: true, rule: "R1" });
});

test("a WebSocket callback cannot inherit transport permission from an EventTarget contract", () => {
  const result = inspect({
    "src/shell/adapters/input.ts":
      "export interface InputEvents { listen(element: EventTarget, handler: () => void): void; }\nexport const input: InputEvents = { listen: (element, handler) => { element.addEventListener('click', handler); } };\n",
    "src/shell/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
    "src/legacy/main.ts":
      "import { run } from '../shell/compositions/run.js';\nexport function main(socket: WebSocket): void { run(() => socket.send('message')); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/shell/compositions/run.ts",
        rule: "R1",
        blocking: true,
      }),
    ]),
  );
});

test.each(["direct", "member-alias"])(
  "an admitted native control cannot grant transport authority through a %s Window route",
  (shape) => {
    const body =
      shape === "direct"
        ? "run(() => { void control.ownerDocument.defaultView?.fetch('https://example.invalid'); });"
        : "const view = control.ownerDocument.defaultView; if (view !== null) { const request = view.fetch; run(() => { void request('https://example.invalid'); }); }";
    const result = inspect({
      "src/shell/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
      "src/legacy/main.ts":
        "import { run } from '../shell/compositions/run.js';\n" +
        `export function main(control: HTMLElement): void { ${body} }\n`,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/shell/compositions/run.ts",
          rule: "R1",
          blocking: true,
        }),
      ]),
    );
  },
);

test.each(["render", "wrong-clock"])(
  "a render adapter's hidden Document authority is confined in the %s case",
  (mode) => {
    const result = inspect(
      {
        "src/shell/adapters/render.ts":
          "export interface Rendering { create(): HTMLElement; }\n" +
          `export const rendering: Rendering = { create: () => { ${mode === "wrong-clock" ? "Date.now();" : ""} return document.createElement('button'); } };\n`,
        "src/shell/compositions/view.ts":
          "import { rendering } from '../adapters/render.js';\nexport function view(): HTMLElement { return rendering.create(); }\n",
      },
      [
        {
          module: "shell/adapters/render",
          export: "rendering",
          capability: "dom.render",
          kind: "external",
          zones: ["shell"],
          contract: { type: "Rendering" },
          globals: ["document"],
        },
      ],
    );
    if (mode === "render") {
      expect(result.findings).toEqual([]);
      expect(result.dependencies).toEqual([]);
    } else {
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "src/shell/adapters/render.ts",
            rule: "R1",
            blocking: true,
          }),
        ]),
      );
    }
  },
);

test("a focus adapter cannot hide Window transport behind its declared UI contract", () => {
  const result = inspect({
    "src/shell/adapters/focus.ts":
      "export interface Focus { to(element: HTMLElement): void; }\nexport const focus: Focus = { to: (element) => { void element.ownerDocument.defaultView?.fetch('https://example.invalid'); } };\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/shell/adapters/focus.ts", rule: "R1", blocking: true }),
    ]),
  );
});

test.each(["direct", "alias"])(
  "an ambient WebSocket constructor cannot enter Core through a %s callback",
  (shape) => {
    const declaration = shape === "alias" ? "const Socket = WebSocket;\n" : "";
    const constructor = shape === "alias" ? "Socket" : "WebSocket";
    const result = inspect({
      "src/core/compositions/run.ts": "export function run(read: () => void): void { read(); }\n",
      "src/legacy/main.ts":
        "import { run } from '../core/compositions/run.js';\n" +
        declaration +
        `export function main(): void { run(() => { void new ${constructor}('wss://example.invalid'); }); }\n`,
    });
    expect(
      result.findings,
      JSON.stringify(
        result.globals.filter(
          (global) => global.file === "src/legacy/main.ts" && global.name === "WebSocket",
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/core/compositions/run.ts",
          rule: "R1",
          blocking: true,
        }),
      ]),
    );
  },
);

test("a legacy creator cannot hide a DOM effect in a closure executed by Core", () => {
  const result = inspect(
    {
      "src/shell/adapters/control-focus.ts":
        "export interface Focus { readonly to: (control: HTMLElement) => void; }\nexport const focus: Focus = { to: (control) => control.focus() };\n",
      "src/legacy/creator.ts":
        "export function create(control: HTMLElement): () => void { return () => control.focus(); }\n",
      "src/core/compositions/run.ts":
        "export function run(callback: () => void): void { callback(); }\n",
      "src/substrate/compositions/bridge.ts":
        "import { create } from '../../legacy/creator.js';\nimport { run } from '../../core/compositions/run.js';\nexport function bridge(control: HTMLElement): void { run(create(control)); }\n",
    },
    [
      {
        module: "shell/adapters/control-focus",
        export: "focus",
        capability: "focus",
        kind: "external",
        zones: ["shell"],
        contract: { type: "Focus" },
      },
    ],
  );
  expect(result.dependencies).toEqual([]);
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "R1",
        path: "src/substrate/compositions/bridge.ts",
        status: "unresolved",
        blocking: true,
        debtKey: expect.stringContaining(
          "R1:callable-binding:src/substrate/compositions/bridge.ts:src/core/compositions/run.ts:",
        ),
      }),
    ]),
  );
});
