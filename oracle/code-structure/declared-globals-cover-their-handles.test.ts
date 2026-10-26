import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedContracts } from "../substrate/compositions/recorded-contracts.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

const surface = "src/shell/adapters/surface.ts";
const transport = "src/shell/adapters/transport.ts";

// What each module holds and the zone rules over it; a fixture that doesn't compile throws. No fixture has
// legacy code, so no edge crosses placement.
function inspect(files: Readonly<Record<string, string>>, adapters: NonNullable<KitConfig["adapters"]>) {
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
    ...files,
  };
  const config = { adapters };
  const snapshot = projectSnapshot(
    { ...recordedAuthority(inputs, config), ...recordedImports(inputs, config), ...recordedContracts(inputs, config) },
    config,
  );
  const context = capabilityContext(snapshot, []);
  const parts = [accessAuthority(snapshot, context), globalAuthority(snapshot, context), importAuthority(snapshot, context)];
  const graph = authorityGraph(snapshot, context, parts, new Set());
  return [...parts.flatMap((part) => part.findings), ...zoneAuthorityCheck(snapshot, context, graph)];
}

const paint =
  "export interface Surface { paint(id: string, text: string): void; }\n" +
  "export const surface: Surface = { paint: (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; } };\n";
const fetchText =
  "export interface Transport { text(url: string): Promise<string>; }\n" +
  "export const transport: Transport = { text: async (url) => (await fetch(url)).text() };\n";

test("handles reached from a declared global are covered inside the adapter that declares it", () => {
  const findings = inspect(
    { [surface]: paint, [transport]: fetchText },
    [
      { module: "shell/adapters/surface", export: "surface", capability: "surface", kind: "external", zones: ["shell"], contract: { type: "Surface" }, globals: ["document"] },
      { module: "shell/adapters/transport", export: "transport", capability: "transport", kind: "external", zones: ["shell"], contract: { type: "Transport" }, globals: ["fetch"] },
    ],
  );
  expect(findings.filter((row) => row.path === surface || row.path === transport)).toEqual([]);
});

test("the same handles in an adapter that declares no host global remain a limit", () => {
  const findings = inspect({ [surface]: paint }, [
    { module: "shell/adapters/surface", export: "surface", capability: "surface", kind: "external", zones: ["shell"], contract: { type: "Surface" } },
  ]);
  expect(findings.map((row) => row.debtKey.split(":").slice(0, 2).join(":"))).toContain(
    "R1:native-authority",
  );
});

test("a composition using the plain contract holds no native authority", () => {
  const composition = "src/shell/compositions/show.ts";
  const findings = inspect(
    {
      [surface]: paint,
      [composition]:
        "import type { Surface } from '../adapters/surface.js';\n" +
        "export function show(surface: Surface, text: string): void { surface.paint('main', text); }\n",
    },
    [
      { module: "shell/adapters/surface", export: "surface", capability: "surface", kind: "external", zones: ["shell"], contract: { type: "Surface" }, globals: ["document"] },
    ],
  );
  expect(findings.filter((row) => row.path === composition)).toEqual([]);
});
