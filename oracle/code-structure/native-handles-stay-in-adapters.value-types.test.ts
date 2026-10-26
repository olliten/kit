import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { behaviourCheck } from "../../src/core/readings/behaviour-check.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

// The same value types are declared by the DOM library and, as globals, by Node's types; each host is
// checked on its own and together.
const hosts = {
  dom: { lib: ["ES2022", "DOM"], types: [] },
  node: { lib: ["ES2022"], types: ["node"] },
  both: { lib: ["ES2022", "DOM"], types: ["node"] },
} as const;

function findings(
  host: keyof typeof hosts,
  files: Readonly<Record<string, string>>,
): readonly string[] {
  const inputs = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: hosts[host].lib,
        types: hosts[host].types,
        typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
    "package.json": JSON.stringify({ type: "module" }),
    ...files,
  };
  // A fixture that doesn't compile throws. What each reading holds, the zone rules over it and the behaviour
  // it may not take; no fixture has legacy code, so no edge crosses placement.
  const snapshot = projectSnapshot({ ...recordedAuthority(inputs), ...recordedImports(inputs) });
  const context = capabilityContext(snapshot, []);
  const parts = [accessAuthority(snapshot, context), globalAuthority(snapshot, context), importAuthority(snapshot, context)];
  const graph = authorityGraph(snapshot, context, parts, new Set());
  return [
    ...parts.flatMap((part) => part.findings),
    ...zoneAuthorityCheck(snapshot, context, graph),
    ...behaviourCheck(snapshot),
  ].map((finding) => finding.debtKey);
}

describe.each(Object.keys(hosts) as (keyof typeof hosts)[])("with the %s host types", (host) => {
  test("a reading taking a URL, its parameters or a text codec has no finding", () => {
    expect(
      findings(host, {
        "src/core/readings/address.ts":
          "export function address(url: URL, query: URLSearchParams): string { return url.host + url.toString() + (query.get('owner') ?? '') + query.toString(); }\n",
        "src/core/readings/codec.ts":
          "export function size(encoder: InstanceType<typeof TextEncoder>, decoder: InstanceType<typeof TextDecoder>, text: string): number { return encoder.encode(text).length + decoder.decode().length + encoder.encoding.length; }\n",
      }),
    ).toEqual([]);
  });

  test("a reading that constructs a URL, its parameters or a text codec has no finding", () => {
    expect(
      findings(host, {
        "src/core/readings/owner.ts":
          "export function owner(path: string): string { const url = new URL(path, 'http://local'); const form = new URLSearchParams({ code: 'c' }); url.searchParams.forEach((value) => value); return (url.searchParams.get('owner') ?? '') + form.toString() + String(URL.canParse(path)); }\n",
        "src/core/readings/bytes.ts":
          "export function length(text: string): number { return new TextEncoder().encode(text).length; }\n",
      }),
    ).toEqual([]);
  });

  test.each(["url", "url.href"])("a Core composition that fetches %s is still authority", (input) => {
    const result = findings(host, {
      "src/core/compositions/status.ts": `export async function status(url: URL): Promise<number> { const response = await fetch(${input}); return response.status; }\n`,
    });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          host === "node"
            ? /^R1:ambient-global:src\/core\/compositions\/status\.ts:fetch$/
            : /^R1:native-authority:src\/core\/compositions\/status\.ts:native:.*lib\.dom\.d\.ts:Response$/,
        ),
      ]),
    );
  });

  test("a URL's object-URL registry is not part of the value", () => {
    expect(
      findings(host, {
        "src/core/readings/release.ts":
          "export function release(url: string): void { URL.revokeObjectURL(url); }\n",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          host === "node"
            ? /^R1:ambient-global:src\/core\/readings\/release\.ts:URL$/
            : /^R1:native-authority:src\/core\/readings\/release\.ts:/,
        ),
      ]),
    );
  });
});

test.each(["Request", "Response", "Headers", "WebSocket"])(
  "a reading taking a %s still holds a native handle",
  (type) => {
    expect(
      findings("dom", {
        "src/core/readings/handle.ts": `export function handle(input: ${type}): string { return String(input); }\n`,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          new RegExp(`^R1:native-authority:src/core/readings/handle\\.ts:native:.*lib\\.dom\\.d\\.ts:${type}$`),
        ),
      ]),
    );
  },
);

test("a method the project merges into URL is supplied behaviour, not part of the value", () => {
  expect(
    findings("dom", {
      "src/augment.d.ts": "interface URL { open(): void; }\n",
      "src/core/readings/address.ts":
        "export function address(url: URL): string { return url.host; }\n",
    }),
  ).toEqual(expect.arrayContaining(["R1:takes-behaviour:src/core/readings/address.ts:address"]));
});
