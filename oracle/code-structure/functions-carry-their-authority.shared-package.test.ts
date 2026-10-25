import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const randomFile = "src/substrate/adapters/random.ts";
const digestFile = "src/substrate/adapters/digest.ts";
const packageName = "shared-crypto";
const randomOwner: NonNullable<KitConfig["adapters"]>[number] = {
  module: "substrate/adapters/random",
  export: "random",
  capability: "randomness",
  kind: "external",
  zones: ["shell", "substrate"],
  contract: { type: "Random" },
  packages: [packageName],
};
const digestOwner: NonNullable<KitConfig["adapters"]>[number] = {
  module: "substrate/adapters/digest",
  export: "digest",
  capability: "digest",
  kind: "external",
  zones: ["substrate"],
  contract: { type: "Digest" },
  packages: [packageName],
};

function inspect(
  entry: string,
  dual: boolean,
  files: Readonly<Record<string, string>> = {},
  config: Partial<KitConfig> = {},
) {
  const snapshot = sourceFixture(
    {
      "src/core/primitives/crypto.d.ts":
        'declare module "shared-crypto" { export function randomValue(): string; export function hash(text: string): string; }',
      [randomFile]:
        'import { randomValue } from "shared-crypto";\n' +
        "export interface Random { readonly id: () => string; }\n" +
        "export const random: Random = { id: () => randomValue() };\n",
      ...(dual
        ? {
            [digestFile]:
              'import { hash } from "shared-crypto";\n' +
              "export interface Digest { readonly hash: (text: string) => string; }\n" +
              "export const digest: Digest = { hash: (text) => hash(text) };\n",
          }
        : {}),
      "src/shell/compositions/run.ts":
        "export function run<T>(read: () => T): T { return read(); }\n",
      "src/main.ts": entry,
      ...files,
    },
    { adapters: dual ? [randomOwner, digestOwner] : [randomOwner], exceptions: ["src/main.ts"], ...config },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return { snapshot, result: capabilityCheck(snapshot) };
}

const runImport = 'import { run } from "./shell/compositions/run.js";\n';
const randomImport = 'import { random } from "./substrate/adapters/random.js";\n';
const origins = (snapshot: ReturnType<typeof sourceFixture>) =>
  snapshot.compiler?.projects.flatMap((project) =>
    project.connections.flatMap((connection) =>
      (connection.callableBindings ?? []).flatMap((binding) => binding.capture?.packages ?? []),
    ),
  );

test.each([
  { form: "closure", dual: false },
  { form: "method", dual: false },
  { form: "closure", dual: true },
  { form: "method", dual: true },
])("a permitted Random $form stays permitted with shared ownership=$dual", ({ form, dual }) => {
  const argument = form === "closure" ? "() => random.id()" : "random.id";
  const { result } = inspect(
    randomImport + runImport + `export const result: string = run(${argument});\n`,
    dual,
  );
  expect(result.findings).toEqual([]);
  expect(result.requirements.find((row) => row.path === randomFile)?.direct).toEqual(["randomness"]);
});

test("a named Random contract can enter a structural Core port without inheriting Digest", () => {
  const { result } = inspect(
    randomImport + runImport + "export const result: string = run(random);\n",
    true,
    {
      "src/core/primitives/port.ts": "export interface Port { readonly id: () => string; }\n",
      "src/shell/compositions/run.ts":
        'import type { Port } from "../../core/primitives/port.js";\n' +
        "export function run(port: Port): string { return port.id(); }\n",
    },
  );
  expect(result.findings).toEqual([]);
});

const hops = (owner: "random" | "digest") => ({
  "src/substrate/compositions/first.ts":
    `export { ${owner} as original } from "../adapters/${owner}.js";\n`,
  "src/substrate/compositions/second.ts": 'export { original as chosen } from "./first.js";\n',
});

test("two re-export aliases retain the actual Random package importer", () => {
  const { snapshot, result } = inspect(
    'import { chosen as source } from "./substrate/compositions/second.js";\n' +
      runImport +
      "export const result: string = run(() => source.id());\n",
    true,
    hops("random"),
  );
  expect(result.findings).toEqual([]);
  expect(origins(snapshot)).toContainEqual({ file: randomFile, specifier: packageName });
});

test("two re-export aliases do not let a real Digest callback enter Shell", () => {
  const { result } = inspect(
    'import { chosen as source } from "./substrate/compositions/second.js";\n' +
      runImport +
      'export const result: string = run(() => source.hash("private"));\n',
    true,
    hops("digest"),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.debtKey).toMatch(/^R1:closure-binding:.*:digest$/);
  expect(result.requirements.find((row) => row.path === digestFile)?.direct).toEqual(["digest"]);
});

test.each(["src/core/readings/raw.ts", "src/core/raw.ts"])(
  "a raw package import in %s keeps its Core refusal even with two owners",
  (path) => {
    const { result } = inspect(
      randomImport + runImport + "export const result: string = run(random.id);\n",
      true,
      {
        [path]:
          'import { randomValue } from "shared-crypto";\n' +
          "export function raw(): string { return randomValue(); }\n",
      },
      { legacyZones: [{ files: ["src/core/raw.ts"], zone: "core" }] },
    );
    expect(
      result.findings.some(
        (finding) => finding.path === path && finding.debtKey.startsWith("R1:package-import:"),
      ),
    ).toBe(true);
  },
);

test("a pure callback in a startup that imports both owners stays pure", () => {
  const { result } = inspect(
    randomImport +
      'import { digest } from "./substrate/adapters/digest.js";\n' +
      runImport +
      'const value = "plain"; export const result: string = run(() => value);\n',
    true,
  );
  expect(result.findings).toEqual([]);
});

test("a dynamic package import records the adapter that actually imports it", () => {
  const { snapshot, result } = inspect(
    randomImport + runImport + "export const result: Promise<string> = run(() => random.id());\n",
    true,
    {
      [randomFile]:
        "export interface Random { readonly id: () => Promise<string>; }\n" +
        "export const random: Random = { id: async () => {\n" +
        '  const source = await import("shared-crypto"); return source.randomValue();\n' +
        "} };\n",
    },
  );
  expect(result.findings).toEqual([]);
  expect(origins(snapshot)).toContainEqual({ file: randomFile, specifier: packageName });
});
