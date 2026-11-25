import { expect, test } from "vitest";
import { browserMapOf } from "../../src/core/readings/browser-map.js";

const digest = "a".repeat(64);

test("a map artifact names each served script by the digest of its bytes, its source base and its map", () => {
  expect(browserMapOf({ version: 1, scripts: [{ scriptHash: digest, base: "", map: "public/generated/app.js.map" }], external: ["https://cdn.example/"] })).toEqual({
    version: 1,
    scripts: [{ scriptHash: digest, base: "", map: "public/generated/app.js.map" }],
    external: ["https://cdn.example/"],
  });
  expect(browserMapOf({ version: 1, scripts: [] })).toEqual({ version: 1, scripts: [], external: [] });
});

test("any other shape, version, key, digest or path is no map artifact", () => {
  const script = { scriptHash: digest, base: "src", map: "app.js.map" };
  for (const value of [
    null, [], {}, { version: 2, scripts: [] }, { version: 1, scripts: [], extra: true }, { version: 1, scripts: {} },
    { version: 1, scripts: [{ ...script, url: "/app.js" }] },
    { version: 1, scripts: [{ ...script, scriptHash: "A".repeat(64) }] },
    { version: 1, scripts: [{ ...script, scriptHash: "a".repeat(63) }] },
    { version: 1, scripts: [script, script] },
    ...["/abs.map", "../out.map", "./app.map", "a//b.map", "a\\b.map", ""].map((map) => ({ version: 1, scripts: [{ ...script, map }] })),
    { version: 1, scripts: [{ ...script, base: "../src" }] },
    { version: 1, scripts: [], external: [""] },
  ]) expect(browserMapOf(value), JSON.stringify(value)).toBeUndefined();
});
