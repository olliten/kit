import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const surface = "src/shell/adapters/surface.ts";
const transport = "src/shell/adapters/transport.ts";

function inspect(files: Readonly<Record<string, string>>, adapters: NonNullable<KitConfig["adapters"]>) {
  const root = mkdtempSync(join(tmpdir(), "kit-derived-handles-"));
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
  try {
    for (const [path, content] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return capabilityCheck(readSnapshot(root, { ...DEFAULT_CONFIG, adapters })).findings;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
