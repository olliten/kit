import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

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

function inspect(body: string, globals?: readonly string[]) {
  const snapshot = sourceFixture(
    {
      [adapter]:
        "export interface View { show(target: Window): string; }\n" +
        `export const view: View = { show: (target) => ${body} };\n`,
    },
    { adapters: registration(globals) },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot).findings.map((item) => item.debtKey);
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
