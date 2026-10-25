import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const run = "src/substrate/compositions/run.ts";
const adapters: NonNullable<KitConfig["adapters"]> = [
  {
    module: "substrate/adapters/journal",
    export: "journal",
    capability: "journal",
    kind: "external",
    zones: ["substrate"],
    contract: { type: "Journal" },
  },
];

function inspect(caller: string, extra: Readonly<Record<string, string>> = {}) {
  const snapshot = sourceFixture(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          types: ["node"],
          typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts", "legacy/**/*.ts"],
      }),
      "package.json": JSON.stringify({ type: "module" }),
      [run]:
        "import type { Journal } from '../adapters/journal.js';\n" +
        "export interface Ports { read(): string; write(value: string): void; }\n" +
        "export function run(read: () => string, write: (value: string) => void): void { write(read()); }\n" +
        "export function runRecord(ports: Ports): void { ports.write(ports.read()); }\n" +
        "export function record(journal: Journal): void { journal.note('ran'); }\n",
      "src/substrate/adapters/journal.ts":
        "export interface Journal { note(text: string): void; }\nexport const journal: Journal = { note: () => {} };\n",
      "legacy/io.ts":
        "export const read = (): string => process.env.HOME ?? '';\n" +
        "export const write = (value: string): void => { process.stdout.write(value); };\n" +
        "export const twice = (value: string): string => value + value;\n",
      "legacy/index.ts": caller,
      ...extra,
    },
    { layout: { legacy: ["legacy"] }, adapters },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings;
}

const atRun = (findings: ReturnType<typeof inspect>) =>
  findings.filter((item) => item.debtKey.startsWith(`R1:callable-binding:${run}:legacy/index.ts:`));

test.each([
  [
    "separate parameters",
    "import { run } from '../src/substrate/compositions/run.js';\n" +
      "const read = (): string => process.env.HOME ?? '';\nconst write = (value: string): void => { process.stdout.write(value); };\nrun(read, write);\n",
  ],
  [
    "a record of functions",
    "import { runRecord } from '../src/substrate/compositions/run.js';\n" +
      "const read = (): string => process.env.HOME ?? '';\nconst write = (value: string): void => { process.stdout.write(value); };\nrunRecord({ read, write });\n",
  ],
  [
    "functions imported from another legacy module",
    "import { run } from '../src/substrate/compositions/run.js';\nimport { read, write } from './io.js';\nrun(read, write);\n",
  ],
])("a legacy callable reaching unresolved authority is not established, passed as %s", (_, caller) => {
  const findings = atRun(inspect(caller));
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.every((item) => item.category === "checker-limit" && item.blocking)).toBe(true);
});

test("a legacy callable reaching only pure code stays established", () => {
  expect(
    atRun(
      inspect(
        "import { run } from '../src/substrate/compositions/run.js';\nimport { twice } from './io.js';\n" +
          "run(() => twice('a'), (value: string): void => { void twice(value); });\n",
      ),
    ),
  ).toEqual([]);
});

test("a registered adapter's contract stays an established port", () => {
  expect(
    atRun(
      inspect(
        "import { record } from '../src/substrate/compositions/run.js';\n" +
          "import { journal } from '../src/substrate/adapters/journal.js';\nrecord(journal);\n",
      ),
    ),
  ).toEqual([]);
});

test("an unclassified package a legacy callable reaches is unresolved too", () => {
  const findings = atRun(
    inspect(
      "import { run } from '../src/substrate/compositions/run.js';\nimport { load } from 'unregistered';\n" +
        "run(() => load(), (value: string): void => { void value; });\n",
      { "legacy/unregistered.d.ts": "declare module 'unregistered' { export function load(): string; }\n" },
    ),
  );
  expect(findings.length).toBeGreaterThan(0);
});

test("a pure value use of a host type is not represented by an earlier native static of the same global", () => {
  expect(
    atRun(
      inspect(
        "import { run } from '../src/substrate/compositions/run.js';\n" +
          "export function drop(url: string): void { URL.revokeObjectURL(url); }\n" +
          "run(() => new URL('https://example.test').host, (value: string): void => { void value; });\n",
      ),
    ),
  ).toEqual([]);
});

test("an adapter importing an unregistered package keeps that limit itself, and its contract port stays established", () => {
  const findings = inspect(
    "import { record } from '../src/substrate/compositions/run.js';\n" +
      "import { journal } from '../src/substrate/adapters/journal.js';\nrecord(journal);\n",
    {
      "legacy/unregistered.d.ts": "declare module 'unregistered' { export function load(): string; }\n",
      "src/substrate/adapters/journal.ts":
        "import { load } from 'unregistered';\n" +
        "export interface Journal { note(text: string): void; }\nexport const journal: Journal = { note: (text) => { void (text + load()); } };\n",
    },
  );
  expect(atRun(findings)).toEqual([]);
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    "R1:external-boundary:src/substrate/adapters/journal.ts:unregistered",
  );
});

test.each([
  [
    "a forwarding function",
    "import { run } from '../src/substrate/compositions/run.js';\nimport { read, write } from './io.js';\n" +
      "function forward(r: () => string, w: (value: string) => void): void { run(r, w); }\nforward(read, write);\n",
  ],
  [
    "a forwarded record",
    "import { runRecord } from '../src/substrate/compositions/run.js';\nimport { read, write } from './io.js';\n" +
      "function forward(ports: { read(): string; write(value: string): void }): void { runRecord(ports); }\nforward({ read, write });\n",
  ],
  [
    "a destructured record",
    "import { run } from '../src/substrate/compositions/run.js';\nimport { read, write } from './io.js';\n" +
      "function forward({ r, w }: { r: () => string; w: (value: string) => void }): void { run(r, w); }\nforward({ r: read, w: write });\n",
  ],
  [
    "a forwarder in another legacy module",
    "import { forward } from './forward.js';\nimport { read, write } from './io.js';\nforward(read, write);\n",
  ],
])("%s carries the unresolved authority of what it is handed", (_, caller) => {
  const findings = inspect(caller, {
    "legacy/forward.ts":
      "import { run } from '../src/substrate/compositions/run.js';\n" +
      "export function forward(r: () => string, w: (value: string) => void): void { run(r, w); }\n",
  }).filter((item) => item.debtKey.startsWith(`R1:callable-binding:${run}:legacy/`));
  expect(findings.length).toBeGreaterThan(0);
});

test("forwarding pure callables stays established", () => {
  expect(
    inspect(
      "import { run } from '../src/substrate/compositions/run.js';\nimport { twice } from './io.js';\n" +
        "function forward(r: () => string, w: (value: string) => void): void { run(r, w); }\n" +
        "forward(() => twice('a'), (value: string): void => { void twice(value); });\n",
    ).filter((item) => item.debtKey.startsWith(`R1:callable-binding:${run}:`)),
  ).toEqual([]);
});

test("a relative import outside the project is as unclassified as an unknown package", () => {
  const findings = atRun(
    inspect(
      "import { run } from '../src/substrate/compositions/run.js';\nimport { load } from '../outside/io.js';\n" +
        "run(() => load(), (value: string): void => { void value; });\n",
      { "outside/io.d.ts": "export declare function load(): string;\n", "outside/io.js": "export const load = () => process.env.HOME;\n" },
    ),
  );
  expect(findings.length).toBeGreaterThan(0);
});

test.each([
  ["dynamic code", "run(() => String(eval('1')), (value: string): void => { void value; });\n"],
  ["a cast of globalThis", "run(() => String((globalThis as { home?: string }).home), (value: string): void => { void value; });\n"],
])("a legacy callable reaching %s is not established", (_, call) => {
  expect(atRun(inspect("import { run } from '../src/substrate/compositions/run.js';\n" + call)).length).toBeGreaterThan(0);
});

test("an adapter with its own unresolved authority keeps that limit, and its contract port stays established", () => {
  const findings = inspect(
    "import { record } from '../src/substrate/compositions/run.js';\n" +
      "import { journal } from '../src/substrate/adapters/journal.js';\nrecord(journal);\n",
    {
      "src/substrate/adapters/journal.ts":
        "export interface Journal { note(text: string): void; }\n" +
        "export const journal: Journal = { note: (text) => { process.stdout.write(text); } };\n",
    },
  );
  expect(atRun(findings)).toEqual([]);
  expect(findings.map((item) => item.debtKey)).toContainEqual(
    "R1:ambient-global:src/substrate/adapters/journal.ts:process",
  );
});

test("a baseline cannot waive the limit, and established callables gain no new charge", async () => {
  const { ratchetFindings } = await import(new URL("../../scripts/kit-check.mjs", import.meta.url).href);
  const findings = inspect(
    "import { run } from '../src/substrate/compositions/run.js';\nimport { read, write } from './io.js';\nrun(read, write);\n",
  );
  const limits = atRun(findings);
  expect(limits.length).toBeGreaterThan(0);
  const baseline = Object.fromEntries(findings.map((item) => [item.debtKey, null]));
  expect(ratchetFindings(findings, baseline, [run], [])).toEqual(expect.arrayContaining(limits));
  const pure = capabilityCheck(
    sourceFixture(
      {
        [run]: "export function run(read: () => string): string { return read(); }\n",
        "legacy/index.ts":
          "import { run } from '../src/substrate/compositions/run.js';\nrun(() => new URL('https://example.test').host);\n",
      },
      { layout: { legacy: ["legacy"] } },
    ),
  );
  expect(pure.findings.filter((item) => item.debtKey.startsWith("R1:callable-binding:"))).toEqual([]);
  expect(pure.requirements.find((row) => row.path === run)).toEqual({ path: run, direct: [], inherited: [] });
});

test("a legacy callable handed to a placed constructor is not established", () => {
  const runner = "src/substrate/compositions/runner.ts";
  const files = {
    [runner]:
      "export class Runner {\n  readonly #read: () => string;\n  constructor(read: () => string) { this.#read = read; }\n" +
      "  value(): string { return this.#read(); }\n}\n",
  };
  const keys = (caller: string) =>
    inspect(caller, files)
      .map((item) => item.debtKey)
      .filter((key) => key.startsWith(`R1:callable-binding:${runner}:legacy/index.ts:`));
  expect(keys("import { Runner } from '../src/substrate/compositions/runner.js';\nimport { read } from './io.js';\nnew Runner(read).value();\n").length).toBeGreaterThan(0);
  expect(keys("import { Runner } from '../src/substrate/compositions/runner.js';\nimport { twice } from './io.js';\nnew Runner(() => twice('a')).value();\n")).toEqual([]);
});

test("a callable default value carries the unresolved authority it reaches", () => {
  const keys = (caller: string) => atRun(inspect(caller));
  expect(
    keys(
      "import { run } from '../src/substrate/compositions/run.js';\nimport { read } from './io.js';\n" +
        "function start(r: () => string = read): void { run(r, (value: string): void => { void value; }); }\nstart();\n",
    ).length,
  ).toBeGreaterThan(0);
  expect(
    keys(
      "import { run } from '../src/substrate/compositions/run.js';\nimport { twice } from './io.js';\n" +
        "function start(r: () => string = () => twice('a')): void { run(r, (value: string): void => { void value; }); }\nstart();\n",
    ),
  ).toEqual([]);
});
