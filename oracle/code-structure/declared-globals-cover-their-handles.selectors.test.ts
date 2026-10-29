import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { openProgram } from "../substrate/compositions/program-fixture.js";

const owner = "src/substrate/adapters/environment.ts";
const selectors = [
  "process.cwd",
  "process.env.LEELOO_PW_WS_ENDPOINT",
  "process.env.LEELOO_PW_WS_ENDPOINTS",
  "process.env.VITEST_POOL_ID",
  "process.env.LEELOO_BROWSER_WORKERS",
  "process.env.PLAYWRIGHT_BROWSERS_PATH",
];
const adapter = {
  module: "substrate/adapters/environment",
  export: "read",
  capability: "environment.read",
  kind: "external",
  zones: ["substrate"],
  globals: selectors,
} satisfies NonNullable<KitConfig["adapters"]>[number];

// Compile actual Node declarations from this checkout's physical dependency directory. The temporary
// project stays outside node_modules, so the recorder retains that directory in declaration identities.
function inspect(body: string, path = owner, adapters: NonNullable<KitConfig["adapters"]> = [adapter]) {
  const config = { adapters };
  const inputs = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022"],
        types: ["node"], typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
        strict: true, skipLibCheck: true, noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
    "package.json": JSON.stringify({ type: "module" }),
    [path]: `export function read(key: string): unknown { ${body} return undefined; }\n`,
  };
  const program = openProgram(inputs, config);
  expect(program.scope.program.getSourceFiles().some((file) => /(?:^|\/)node_modules\/@types\/node\//.test(file.fileName))).toBe(true);
  const facts = recordedAuthority(inputs, config);
  const snapshot = projectSnapshot(facts, config);
  const context = capabilityContext(snapshot, []);
  return [accessAuthority(snapshot, context), globalAuthority(snapshot, context)]
    .flatMap((part) => part.findings).filter((finding) => finding.path === path);
}

test.each([
  "return process.cwd();",
  "const cwd = process.cwd; return cwd;",
  ...selectors.slice(1).map((selector) => `return ${selector};`),
  'process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/opt/pw-browsers";',
  'process.env.LEELOO_PW_WS_ENDPOINTS = "ws://worker";',
  "delete process.env.LEELOO_PW_WS_ENDPOINTS;",
])("the declaring adapter may use exactly the approved selector: %s", (body) => {
  expect(inspect(body)).toEqual([]);
});

test.each([
  "return process;",
  "return process.env;",
  "const host = process; return host.cwd();",
  "const env = process.env; return env.VITEST_POOL_ID;",
  "return process.env.HOME;",
  "return process.pid;",
  'return process["cwd"]();',
  'return process.env["VITEST_POOL_ID"];',
  "return process.env[key];",
  "return globalThis.process.cwd();",
  "return (globalThis as any).process.cwd();",
])("a narrow selector does not grant broader or indirect access: %s", (body) => {
  expect(inspect(body)).toEqual(expect.arrayContaining([expect.objectContaining({ blocking: true })]));
});

test.each(["src/substrate/adapters/other.ts", "src/substrate/compositions/read.ts"])(
  "a selector grants no raw access outside its owner: %s", (path) => {
    expect(inspect("return process.cwd();", path)).toEqual(
      expect.arrayContaining([expect.objectContaining({ blocking: true })]),
    );
  },
);

test("an unregistered ambient selector remains blocked", () => {
  expect(inspect("return process.cwd();", owner, [])).toEqual(
    expect.arrayContaining([expect.objectContaining({ blocking: true })]),
  );
});
