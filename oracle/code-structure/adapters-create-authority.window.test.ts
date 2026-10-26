import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { constructionCheck } from "../../src/core/readings/construction-check.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { registrationCheck } from "../../src/core/readings/registration-check.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedContracts } from "../substrate/compositions/recorded-contracts.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

const adapter = "src/shell/adapters/view.ts";
const registration = (globals?: readonly string[]): NonNullable<KitConfig["adapters"]> => [
  {
    module: "shell/adapters/view",
    export: "view",
    capability: "rendering",
    kind: "external",
    zones: ["shell"],
    contract: { type: "View" },
    ...(globals === undefined ? {} : { globals }),
  },
];

// What the registration, authority, zone and construction checks find for the adapter. A fixture that doesn't
// compile throws.
function inspect(body: string, globals?: readonly string[]) {
  const config = { adapters: registration(globals) };
  const files = {
    [adapter]:
      "export interface View { show(target: Window): string; }\n" +
      `export const view: View = { show: (target) => ${body} };\n`,
  };
  const snapshot = projectSnapshot(
    { ...recordedImports(files, config), ...recordedAuthority(files, config), ...recordedContracts(files, config) },
    config,
  );
  const context = capabilityContext(snapshot, []);
  const parts = [accessAuthority(snapshot, context), globalAuthority(snapshot, context), importAuthority(snapshot, context)];
  const graph = authorityGraph(snapshot, context, parts, new Set());
  return [
    ...registrationCheck(snapshot, context),
    ...parts.flatMap((part) => part.findings),
    ...zoneAuthorityCheck(snapshot, context, graph),
    ...constructionCheck(snapshot, context.startups),
  ].map((item) => item.debtKey);
}

const windowFinding = new RegExp(`^R1:native-authority:${adapter}:native:.*lib\\.dom\\.d\\.ts:Window$`);

test("a contract naming Window does not let the adapter reach the window global undeclared", () => {
  expect(inspect("window.name")).toContainEqual(expect.stringMatching(windowFinding));
  expect(inspect("String(globalThis.innerWidth)")).toContainEqual(expect.stringMatching(windowFinding));
});

test("a declared window global still covers the adapter's own use", () => {
  expect(inspect("window.name", ["window"])).toEqual([]);
});

test("the Window handle the contract supplies stays the adapter's to use", () => {
  expect(inspect("target.name")).toEqual([]);
});
