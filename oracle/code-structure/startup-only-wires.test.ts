import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../lib/source-fixture.js";

const startup = "src/start.ts";
const shell = "src/shell/readings/view.ts";
const server = "src/substrate/compositions/server.ts";
const files = {
  // Top-level await needs an ECMAScript module.
  "package.json": '{ "type": "module" }\n',
  [shell]: "export function view(): string { return 'view'; }\n",
  [server]:
    "export interface Options { readonly [key: string]: unknown; }\n" +
    "export const settings: Options = { mode: 'dev' };\n" +
    "export const routes: { readonly [key: string]: string } = { home: '/' };\n" +
    "export const handles: { readonly home: string } | undefined = { home: '/' };\n" +
    "export const state: { count: number; extra?: string } = { count: 0 };\n" +
    "export class Server {\n" +
    "  constructor(readonly options: Options) {}\n" +
    "  listen(port: number): Promise<number> { return Promise.resolve(port); }\n" +
    "}\n" +
    "export function serve(view: () => string, options: Options, list: readonly unknown[]): string {\n" +
    "  return view() + String(options) + list.length;\n" +
    "}\n",
};

function inspect(source: string, config: Partial<KitConfig> = {}, path = startup) {
  const snapshot = sourceFixture({ ...files, [path]: source }, { exceptions: [startup], ...config });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings;
}

const wiringOf = (findings: ReturnType<typeof inspect>) =>
  findings.filter((finding) => finding.debtKey.startsWith("R2:startup-wiring:"));

const wired =
  "import { view } from './shell/readings/view.js';\n" +
  "import type { Options } from './substrate/compositions/server.js';\n" +
  "import * as server from './substrate/compositions/server.js';\n" +
  "import { Server, routes, settings } from './substrate/compositions/server.js';\n" +
  "const { serve, handles: { home } = { home: '/' } } = server;\n" +
  "const options: Options = {\n" +
  "  name: 'kit', port: 8080, on: true, off: false, none: null, nothing: undefined, path: `/`,\n" +
  "  'quoted': home, ['computed']: routes['home'], view, ...settings,\n" +
  "};\n" +
  "const instance: Server = new Server(options);\n" +
  "const listening: number = await instance.listen(8080);\n" +
  "const list = [view, listening, options.name, (server.routes)] as const;\n" +
  "serve(view, options satisfies Options, list);\n" +
  "await instance.listen(listening);\n" +
  "export const started: string = server.serve(view, instance.options, [routes[0]]);\n" +
  "export { instance, listening };\n" +
  "export type { Options };\n" +
  "export { view as page } from './shell/readings/view.js';\n" +
  "export * from './substrate/compositions/server.js';\n" +
  "export default instance;\n";

test("a startup that only imports, names, calls and exports what it wires has no finding", () => {
  expect(inspect(wired)).toEqual([]);
});

test("a type assertion or non-null assertion in startup wiring stays a type escape, not logic", () => {
  const findings = inspect(
    "import { view } from './shell/readings/view.js';\n" +
      "import { handles, serve, settings, type Options } from './substrate/compositions/server.js';\n" +
      "serve(view, settings as Options, [handles!.home]);\n",
  );
  expect(wiringOf(findings)).toEqual([]);
  expect(findings.map((finding) => finding.debtKey.split(":")[1])).toEqual([
    "type-escape",
    "type-escape",
  ]);
});

const base =
  "import { view } from './shell/readings/view.js';\n" +
  "import { handles, routes, serve, settings, state } from './substrate/compositions/server.js';\n" +
  "const name = 'kit';\n" +
  "const port = 8080;\n" +
  "const on = true;\n" +
  "const list = [view];\n" +
  "serve(view, settings, list);\n";

// Each form, the source that holds it, and where its node starts when that is not the statement.
const forbidden: readonly { readonly kind: string; readonly source: string; readonly at?: string }[] = [
  { kind: "IfStatement", source: "if (on) serve(view, settings, list);\n" },
  { kind: "ForStatement", source: "for (let index = 0; index < port; index += 1) serve(view, settings, list);\n" },
  { kind: "ForOfStatement", source: "for (const item of list) serve(item, settings, list);\n" },
  { kind: "WhileStatement", source: "while (on) serve(view, settings, list);\n" },
  { kind: "DoStatement", source: "do serve(view, settings, list); while (on);\n" },
  { kind: "SwitchStatement", source: "switch (name) { case 'kit': serve(view, settings, list); }\n" },
  { kind: "TryStatement", source: "try { serve(view, settings, list); } catch { serve(view, settings, list); }\n" },
  { kind: "ThrowStatement", source: "throw new Error(name);\n" },
  { kind: "LabeledStatement", source: "wire: { serve(view, settings, list); break wire; }\n" },
  { kind: "LetKeyword", source: "let count = port;\nserve(view, { count }, list);\n" },
  { kind: "VarKeyword", source: "var count = port;\nserve(view, { count }, list);\n" },
  { kind: "FunctionDeclaration", source: "function make(): string { return name; }\nserve(make, settings, list);\n" },
  { kind: "ClassDeclaration", source: "class Local {}\nserve(view, { local: new Local() }, list);\n" },
  { kind: "EnumDeclaration", source: "enum Mode { On }\nserve(view, { mode: Mode.On }, list);\n" },
  { kind: "ModuleDeclaration", source: "namespace Space { export const value = 1; }\nserve(view, { value: Space.value }, list);\n" },
  { kind: "ArrowFunction", source: "serve(() => name, settings, list);\n", at: "() =>" },
  { kind: "FunctionExpression", source: "serve(function () { return name; }, settings, list);\n", at: "function" },
  { kind: "BinaryExpression", source: "const sum = port + 1;\nserve(view, { sum }, list);\n", at: "port +" },
  { kind: "PrefixUnaryExpression", source: "const off = !on;\nserve(view, { off }, list);\n", at: "!on" },
  { kind: "ConditionalExpression", source: "const chosen = on ? name : 'other';\nserve(view, { chosen }, list);\n", at: "on ?" },
  { kind: "BinaryExpression", source: "const both = on && port;\nserve(view, { both }, list);\n", at: "on &&" },
  { kind: "BinaryExpression", source: "const fallback = handles ?? settings;\nserve(view, fallback, list);\n", at: "handles ??" },
  { kind: "TemplateExpression", source: "const greeting = `hi ${name}`;\nserve(view, { greeting }, list);\n", at: "`hi" },
  { kind: "BinaryExpression", source: "state.count = port;\n" },
  { kind: "BinaryExpression", source: "state.count += port;\n" },
  { kind: "DeleteExpression", source: "delete state.extra;\n" },
  { kind: "TypeOfExpression", source: "const kind = typeof name;\nserve(view, { kind }, list);\n", at: "typeof" },
  { kind: "VoidExpression", source: "void name;\n" },
  { kind: "Identifier", source: "console.log(name);\n" },
  { kind: "DebuggerStatement", source: "debugger;\n" },
  {
    kind: "ElementAccessExpression",
    source: "const route = routes[name];\nserve(view, { route }, list);\n",
    at: "routes[name]",
  },
];

test.each(forbidden)("a $kind in startup is one wiring finding at that node", ({ kind, source, at }) => {
  const findings = wiringOf(inspect(base + source));
  const start = base.length + (at === undefined ? 0 : source.indexOf(at));
  expect(findings).toEqual([
    expect.objectContaining({
      rule: "R2",
      path: startup,
      debtKey: `R2:startup-wiring:${startup}:${kind}:${start}`,
      fix: "Move this logic into the module it wires and pass it by name; a startup only wires.",
      blocking: true,
      status: "violation",
      category: "placed-violation",
    }),
  ]);
});

test.each(forbidden)("a $kind outside startup is no wiring finding", ({ source }) => {
  expect(wiringOf(inspect(base + source, {}, "src/other.ts"))).toEqual([]);
});

test("a placed module declared as startup is not held to wiring", () => {
  const findings = inspect(wired, { exceptions: [startup, server] });
  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: `R2:startup-placement:${server}:${server}` }),
    ]),
  );
  expect(wiringOf(findings)).toEqual([]);
});

test("a startup inside a legacy zone is not held to wiring", () => {
  const findings = inspect(base + "serve(() => name, settings, list);\n", {
    legacyZones: [{ root: "src", zone: "substrate" }],
  });
  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: expect.stringContaining("R2:startup-placement:") }),
    ]),
  );
  expect(wiringOf(findings)).toEqual([]);
});
