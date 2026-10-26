import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { behaviourCheck } from "../../src/core/readings/behaviour-check.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { edgeCheck } from "../../src/core/readings/edge-check.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedContracts } from "../substrate/compositions/recorded-contracts.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

// What each module holds, the edges between modules, the zone rules over what each holds and the behaviour
// the core may not take; a fixture that doesn't compile throws.
function findings(
  files: Readonly<Record<string, string>>,
  adapters: NonNullable<KitConfig["adapters"]>,
) {
  const config = { adapters };
  const snapshot = projectSnapshot(
    { ...recordedAuthority(files, config), ...recordedImports(files, config), ...recordedContracts(files, config) },
    config,
  );
  const context = capabilityContext(snapshot, []);
  const parts = [accessAuthority(snapshot, context), globalAuthority(snapshot, context), importAuthority(snapshot, context)];
  const edges = edgeCheck(snapshot, context);
  const graph = authorityGraph(snapshot, context, parts, edges.crossZoneFailures);
  return [
    ...parts.flatMap((part) => part.findings),
    ...edges.findings,
    ...zoneAuthorityCheck(snapshot, context, graph),
    ...behaviourCheck(snapshot),
  ];
}

const registration = (
  zone: "shell" | "substrate",
  globals: readonly string[],
): NonNullable<KitConfig["adapters"]> => [
  {
    module: `${zone}/adapters/host`,
    export: "host",
    capability: "host",
    kind: "external",
    zones: ["shell", "substrate"],
    contract: { type: "Host" },
    globals,
  },
];

const host = (body: string): string =>
  "export interface Host { run(): void; }\n" +
  `export const host: Host = { run: () => { ${body} } };\n`;

const inspect = (zone: "shell" | "substrate", body: string, globals: readonly string[]) =>
  findings({ [`src/${zone}/adapters/host.ts`]: host(body) }, registration(zone, globals));

test.each([
  ["document", "document.createElement('button');", ["document"]],
  ["a global alias", "const page = document; page.createElement('button');", ["document"]],
  ["a window-only function", "alert('hello');", ["alert"]],
  ["globalThis", "globalThis.alert('hello');", ["globalThis.alert"]],
] as const)("declaring %s cannot grant Window authority to Substrate", (_, body, globals) => {
  expect(inspect("substrate", body, globals)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: "R1:window-authority:src/substrate/adapters/host.ts",
        blocking: true,
      }),
    ]),
  );
});

test("Shell retains its declared document authority", () => {
  expect(inspect("shell", "document.createElement('button');", ["document"])).toEqual([]);
});

test("shared HTTP and cancellation APIs remain usable in Substrate adapters", () => {
  expect(
    inspect(
      "substrate",
      "fetch('https://example.test', { signal: new AbortController().signal });",
      ["fetch", "AbortController"],
    ),
  ).toEqual([]);
});

test("a native element contract cannot grant Window authority to Substrate", () => {
  expect(
    findings(
      {
        "src/substrate/adapters/host.ts":
          "export interface Host { focus(element: HTMLElement): void; }\n" +
          "export const host: Host = { focus: element => element.focus() };\n",
      },
      registration("substrate", []),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: "R1:window-authority:src/substrate/adapters/host.ts" }),
    ]),
  );
});

test("a plain adapter contract cannot hide Window authority from a transitive Substrate caller", () => {
  expect(
    findings(
      {
        "src/shell/adapters/host.ts": host("document.createElement('button');"),
        "src/legacy/bridge.ts": "export { host } from '../shell/adapters/host.js';\n",
        "src/substrate/compositions/run.ts":
          "import { host } from '../../legacy/bridge.js';\nexport function run(): void { host.run(); }\n",
      },
      registration("shell", ["document"]),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: "R1:window-authority:src/substrate/compositions/run.ts" }),
    ]),
  );
});

test("a Shell callback cannot reach a Substrate composition, since Shell cannot import it", () => {
  expect(
    findings(
      {
        "src/shell/adapters/host.ts": host("document.createElement('button');"),
        "src/substrate/compositions/apply.ts":
          "export function apply(run: () => void): void { run(); }\n",
        "src/shell/compositions/view.ts":
          "import { host } from '../adapters/host.js';\n" +
          "import { apply } from '../../substrate/compositions/apply.js';\nexport function view(): void { apply(() => host.run()); }\n",
      },
      registration("shell", ["document"]),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: "R2:layer-edge:src/shell/compositions/view.ts:src/substrate/compositions/apply.ts",
      }),
    ]),
  );
});

test("a property-only live DOM handle cannot enter Substrate", () => {
  expect(
    findings(
      {
        "src/substrate/adapters/host.ts":
          "export interface Host { write(value: SVGAnimatedString): void; }\n" +
          "export const host: Host = { write(value) { value.baseVal = 'next'; } };\n",
      },
      registration("substrate", []),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: "R1:window-authority:src/substrate/adapters/host.ts" }),
    ]),
  );
});

test("a Window-only options dictionary is still plain supplied data in Core", () => {
  expect(
    findings(
      {
        "src/core/readings/position.ts":
          "export function position(options: ScrollToOptions): number { return options.top ?? 0; }\n",
      },
      [],
    ),
  ).toEqual([]);
});
