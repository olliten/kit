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
