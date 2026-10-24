import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { hostOf, hostOfFile } from "../../src/core/readings/host-of.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";
import { configuredHosts } from "../../scripts/kit-config.mjs";

const hosts: NonNullable<KitConfig["hosts"]> = {
  browser: { lib: ["dom"], zone: "shell" },
  server: { lib: ["node"], zone: "substrate" },
};

function inspect(files: Readonly<Record<string, string>>, config: Partial<KitConfig> = {}) {
  const snapshot = sourceFixture(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM"],
          types: ["node"],
          typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      "package.json": JSON.stringify({ type: "module" }),
      ...files,
    },
    { hosts, ...config },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings;
}

const adapter = (zone: "shell" | "substrate", globals: readonly string[]): NonNullable<KitConfig["adapters"]> => [
  {
    module: `${zone}/adapters/host`,
    export: "host",
    capability: "host",
    kind: "external",
    zones: [zone],
    contract: { type: "Host" },
    globals,
  },
];
const host = (body: string): string =>
  `export interface Host { run(): unknown; }\nexport const host: Host = { run: () => ${body} };\n`;

test("a DOM global in a server-host module is a finding", () => {
  expect(
    inspect({ "src/substrate/adapters/host.ts": host("document.title") }, { adapters: adapter("substrate", ["document"]) }),
  ).toContainEqual(expect.objectContaining({ debtKey: "R1:window-authority:src/substrate/adapters/host.ts" }));
});

test("a global only Node's declarations provide is a finding in a host without node", () => {
  expect(
    inspect({ "src/shell/adapters/host.ts": host("process.cwd()") }, { adapters: adapter("shell", ["process"]) }),
  ).toContainEqual(
    expect.objectContaining({ debtKey: "R1:host-global:src/shell/adapters/host.ts:process", category: "placed-violation" }),
  );
});

test("each global is clean in a host whose libraries declare it", () => {
  expect(
    inspect({ "src/substrate/adapters/host.ts": host("process.cwd()") }, { adapters: adapter("substrate", ["process"]) }),
  ).toEqual([]);
  expect(
    inspect({ "src/shell/adapters/host.ts": host("document.title") }, { adapters: adapter("shell", ["document"]) }),
  ).toEqual([]);
});

test("a global both a compiler library and a package declare belongs to the library", () => {
  expect(
    inspect(
      { "src/shell/adapters/host.ts": host("fetch('https://example.test')") },
      { adapters: adapter("shell", ["fetch"]) },
    ),
  ).toEqual([]);
});

test("without hosts each zone keeps its derived host and the core runs in none", () => {
  const model = hostOf(DEFAULT_CONFIG);
  expect(model.deprecated).toEqual([]);
  expect(model.hosts.map((entry) => [entry.name, entry.lib, entry.zone])).toEqual([
    ["browser", ["dom"], "shell"],
    ["server", ["node", "webworker"], "substrate"],
    ["proof", ["dom", "node"], null],
  ]);
  const of = (path: string, zone: "core" | "shell" | "substrate", test = false) =>
    hostOfFile(model, DEFAULT_CONFIG, path, zone, test)?.name;
  expect(of("src/shell/adapters/surface.ts", "shell")).toBe("browser");
  expect(of("src/substrate/adapters/store.ts", "substrate")).toBe("server");
  expect(of("src/core/readings/total.ts", "core")).toBeUndefined();
  expect(of("oracle/substrate/adapters/fixture.ts", "substrate")).toBe("proof");
});

test.each([
  [{ server: { lib: [] } }, /lib/],
  [{ server: { lib: ["node"], zone: "core" } }, /core runs in no host/],
  [{ one: { lib: ["dom"], zone: "shell" }, two: { lib: ["dom"], zone: "shell" } }, /one host runs each zone/],
  [{ server: { lib: ["node"], globals: [] } }, /not a host field/],
  [{ page: { lib: ["dom"], "entered-by": ["PageFunction"] } }, /entered-by/],
  [{ server: { lib: ["node"], entries: ["src/*.ts"] } }, /entries/],
  [{ Server: { lib: ["node"] } }, /host name/],
])("a malformed host declaration is an error: %j", (declaration, message) => {
  expect(() => configuredHosts(declaration)).toThrow(message);
});
