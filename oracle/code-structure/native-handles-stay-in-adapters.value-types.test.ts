import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const kit = fileURLToPath(new URL("../..", import.meta.url));

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
  const root = mkdtempSync(join(tmpdir(), "kit-value-types-"));
  try {
    const inputs = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: hosts[host].lib,
          types: hosts[host].types,
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      "package.json": JSON.stringify({ type: "module" }),
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    mkdirSync(join(root, "node_modules"));
    symlinkSync(join(kit, "node_modules/@types"), join(root, "node_modules/@types"));
    const snapshot = readSnapshot(root, DEFAULT_CONFIG);
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    return capabilityCheck(snapshot).findings.map((finding) => finding.debtKey);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  ).toEqual(expect.arrayContaining(["R1:reading-callable:src/core/readings/address.ts:url"]));
});
