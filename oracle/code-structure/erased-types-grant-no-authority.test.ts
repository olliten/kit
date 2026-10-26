import { expect, test } from "vitest";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";

// The globals a source records, and what deriving its authority and checking its zone find. A fixture that
// doesn't compile throws.
function inspect(source: string) {
  const facts = recordedAuthority({ "src/core/compositions/sample.ts": source });
  const snapshot = projectSnapshot(facts);
  const context = capabilityContext(snapshot, []);
  const parts = [accessAuthority(snapshot, context), globalAuthority(snapshot, context), importAuthority(snapshot, context)];
  const graph = authorityGraph(snapshot, context, parts, new Set());
  return {
    globals: facts.globals,
    findings: [...parts.flatMap((part) => part.findings), ...zoneAuthorityCheck(snapshot, context, graph)],
  };
}

test("augmenting the event type map does not acquire its merged SDK capabilities", () => {
  const result = inspect(
    "declare global { interface GlobalEventHandlersEventMap { 'sample-output': CustomEvent<Readonly<{value:number}>>; } }\n" +
      "export function sample(): number { return 1; }\n",
  );
  const declarations = result.globals.filter(
    (global) => global.name === "GlobalEventHandlersEventMap",
  );
  expect(declarations.length).toBeGreaterThan(0);
  expect(declarations.every((global) => global.runtime === false)).toBe(true);
  expect(result.findings).toEqual([]);
});

test("a constructor type alias does not acquire runtime transport authority", () => {
  const result = inspect(
    "export type SocketConstructor = typeof WebSocket;\nexport function sample(): number { return 1; }\n",
  );
  const mentions = result.globals.filter((global) => global.name === "WebSocket");
  expect(mentions.length).toBeGreaterThan(0);
  expect(mentions.every((global) => global.runtime === false)).toBe(true);
  expect(result.findings).toEqual([]);
});

test("the actual event constructor remains runtime authority in Core", () => {
  const result = inspect(
    "export function sample(): void { void new CustomEvent('sample-output', {detail:1}); }\n",
  );
  expect(result.globals.some((global) => global.name === "CustomEvent" && global.runtime)).toBe(
    true,
  );
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/core/compositions/sample.ts",
        rule: "R1",
        category: "checker-limit",
        blocking: true,
        debtKey: expect.stringMatching(
          /^R1:native-authority:src\/core\/compositions\/sample\.ts:.*CustomEvent$/,
        ),
      }),
    ]),
  );
});

test("a value alias remains runtime authority while its typeof constraint is erased", () => {
  const result = inspect(
    "export function sample<T extends typeof WebSocket>(): void { const Socket = WebSocket; void new Socket('wss://example.invalid'); }\n",
  );
  const mentions = result.globals.filter((global) => global.name === "WebSocket");
  expect(mentions.some((global) => global.runtime === false)).toBe(true);
  expect(mentions.some((global) => global.runtime)).toBe(true);
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/core/compositions/sample.ts",
        rule: "R1",
        category: "checker-limit",
        blocking: true,
        debtKey: expect.stringMatching(
          /^R1:native-authority:src\/core\/compositions\/sample\.ts:.*WebSocket$/,
        ),
      }),
    ]),
  );
});
