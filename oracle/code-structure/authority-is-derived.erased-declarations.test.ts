import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

function inspect(source: string) {
  const root = mkdtempSync(join(tmpdir(), "kit-erased-declarations-"));
  try {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM"],
          types: [],
          strict: true,
          noEmit: true,
          declaration: true,
          isolatedDeclarations: true,
        },
        include: ["src/**/*.ts"],
      }),
      "src/core/compositions/sample.ts": source,
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const snapshot = readSnapshot(root, DEFAULT_CONFIG);
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    return {
      globals: snapshot.compiler?.projects.flatMap((project) => project.globals) ?? [],
      findings: capabilityCheck(snapshot).findings,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
