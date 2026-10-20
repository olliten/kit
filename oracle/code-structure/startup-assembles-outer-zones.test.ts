import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";
import { configuredKit, kitConfig } from "../../scripts/kit-config.mjs";

const startup = "src/start.ts";
const shell = "src/shell/readings/view.ts";
const server = "src/substrate/compositions/server.ts";
const files = {
  [startup]:
    "import { view } from './shell/readings/view.js';\n" +
    "import { serve } from './substrate/compositions/server.js';\nserve(view);\n",
  [shell]: "export function view(): string { return 'view'; }\n",
  [server]: "export function serve(view: () => string): string { return view(); }\n",
};

function inspect(extra: Readonly<Record<string, string>> = {}, config: Partial<KitConfig> = {}) {
  const snapshot = sourceFixture({ ...files, ...extra }, { exceptions: [startup], ...config });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings;
}

test("an exact existing startup outside zones assembles both outer contracts", () => {
  expect(inspect()).toEqual([]);
});

test("the application configuration reader carries exact startup exceptions into checking", () => {
  const declaration = kitConfig(
    "```yaml\nroots: { src: src/, spec: spec/, oracle: oracle/ }\nterms: spec/terms.md\nexceptions: [src/start.ts]\n```\n",
  );
  const config = configuredKit(DEFAULT_CONFIG, declaration);
  expect(config.exceptions).toEqual([startup]);
  expect(capabilityCheck(sourceFixture(files, config)).findings).toEqual([]);
});

test("a startup declaration does not permit an ordinary Substrate import of Shell", () => {
  expect(
    inspect({
      [server]:
        "import { view } from '../../shell/readings/view.js';\n" +
        "export function serve(read: () => string): string { return read() + view(); }\n",
    }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule: "R2", path: server, blocking: true })]),
  );
});

test.each(["runtime", "type"])(
  "application code cannot import startup through a %s edge",
  (kind) => {
    const caller = "src/substrate/compositions/caller.ts";
    const findings = inspect({
      [startup]:
        files[startup] +
        "export interface Options { readonly name: string; }\nexport const name: string = 'start';\n",
      [caller]:
        kind === "type"
          ? "import type { Options } from '../../start.js';\nexport function read(value: Options): string { return value.name; }\n"
          : "import { name } from '../../start.js';\nexport function read(): string { return name; }\n",
    });
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: expect.stringContaining("R2:startup-import:"),
          path: caller,
          blocking: true,
        }),
      ]),
    );
  },
);

test("a placed file cannot be made startup by an exception declaration", () => {
  expect(inspect({}, { exceptions: [startup, server] })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining("R2:startup-placement:"),
        blocking: true,
      }),
    ]),
  );
});

test("an existing legacy zone cannot be hidden by an exact startup exception", () => {
  expect(inspect({}, { legacyZones: [{ root: "src", zone: "substrate" }] })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining("R2:startup-placement:"),
        blocking: true,
      }),
    ]),
  );
});

test.each(["src/", "src/*.ts", "src/start", "src/missing.ts"])(
  "%s does not exempt application source",
  (exception) => {
    expect(inspect({}, { exceptions: [exception] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ blocking: true })]),
    );
  },
);

test("startup imports do not permit raw clock reads in a descendant", () => {
  expect(
    inspect({
      [server]:
        "export function serve(read: () => string): string { return read() + Date.now(); }\n",
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining("R1:raw-primitive:"),
        path: server,
        blocking: true,
      }),
    ]),
  );
});

test("startup does not let a descendant carry external authority into Core", () => {
  const core = "src/core/compositions/read.ts";
  expect(
    inspect(
      {
        "src/substrate/adapters/clock.ts":
          "export function clock(): number { return Date.now(); }\n",
        [core]: "export function read(now: () => number): number { return now(); }\n",
        [server]:
          "import { clock } from '../adapters/clock.js';\nimport { read } from '../../core/compositions/read.js';\n" +
          "export function serve(view: () => string): string { return view() + read(clock); }\n",
      },
      {
        adapters: [
          {
            module: "substrate/adapters/clock",
            export: "clock",
            capability: "clock.read",
            kind: "external",
            zones: ["substrate"],
            primitives: ["clock"],
          },
        ],
      },
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining("R1:closure-binding:"),
        blocking: true,
      }),
    ]),
  );
});

test("startup does not hide a descendant import cycle", () => {
  expect(
    inspect({
      [shell]:
        "import { other } from './other.js';\nexport function view(): string { return 'view'; }\nvoid other;\n",
      "src/shell/readings/other.ts":
        "import { view } from './view.js';\nexport function other(): string { return 'other'; }\nvoid view;\n",
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: expect.stringContaining("R2:cycle:"), blocking: true }),
    ]),
  );
});

test("startup does not permit a descendant to construct a Core producer's writes", () => {
  const description = "export interface Write { readonly key: string; readonly value: number; }\n";
  expect(
    inspect(
      {
        "src/core/primitives/write.ts": description,
        "src/core/compositions/produce.ts":
          "import type { Write } from '../primitives/write.js';\nexport function produce(key: string, value: number): Write { return { key, value }; }\n",
        [server]:
          "import type { Write } from '../../core/primitives/write.js';\n" +
          "export function serve(view: () => string): Write { return { key: view(), value: 7 }; }\n",
      },
      {
        adapters: [
          {
            module: "core/compositions/produce",
            export: "produce",
            capability: "write.produce",
            kind: "produce",
            zones: ["core"],
          },
        ],
      },
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringContaining("R2:write-construction:"),
        path: server,
        blocking: true,
      }),
    ]),
  );
});

test.each(["invoke", "construct"])(
  "startup may carry Core writes but only their producer may construct them: %s",
  (operation) => {
    const findings = inspect(
      {
        "src/core/primitives/write.ts":
          "export interface Write { readonly key: string; readonly value: number; }\n",
        "src/core/compositions/produce.ts":
          "import type { Write } from '../primitives/write.js';\nexport function produce(key: string, value: number): Write { return { key, value }; }\n",
        [startup]:
          files[startup] +
          "import type { Write } from './core/primitives/write.js';\nimport { produce } from './core/compositions/produce.js';\n" +
          "function carry(write: Write): Write { return write; }\n" +
          (operation === "invoke"
            ? "carry(produce('key', 7));\n"
            : "void produce; const write: Write = { key: 'key', value: 7 }; carry(write);\n"),
      },
      {
        adapters: [
          {
            module: "core/compositions/produce",
            export: "produce",
            capability: "write.produce",
            kind: "produce",
            zones: ["core"],
          },
        ],
      },
    );
    if (operation === "invoke") expect(findings).toEqual([]);
    else
      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            debtKey: expect.stringContaining("R2:write-construction:"),
            path: startup,
            blocking: true,
          }),
        ]),
      );
  },
);

test("startup does not suppress compiler failures in its dependencies", () => {
  const snapshot = sourceFixture(
    { ...files, [server]: "export function serve(view: () => string): string { return 7; }\n" },
    { exceptions: [startup] },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual(
    expect.arrayContaining([expect.objectContaining({ file: server, code: 2322 })]),
  );
  expect(capabilityCheck(snapshot).findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringMatching(
          /^R1:compiler:src\/substrate\/compositions\/server\.ts:2322:\d+$/,
        ),
        rule: "R1",
        path: server,
        blocking: true,
        status: "violation",
        category: "placed-violation",
      }),
    ]),
  );
});
