import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";

const { configuredKit } = await import(
  new URL("../../scripts/kit-config.mjs", import.meta.url).href
);
const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };

test("the existing single-root declaration keeps its configuration", () => {
  const config = configuredKit(DEFAULT_CONFIG, { roots, terms: "spec/terms.md" });
  expect([config.srcRoot, config.specRoot, config.oracleRoot]).toEqual(["src", "spec", "oracle"]);
});

test.each([
  { ...roots, src: ["src/", "oracle/"] },
  { ...roots, code: ["src/", "oracle/"] },
  { ...roots, extra: "oracle/" },
  { ...roots, src: "" },
])("unsupported root declaration %j cannot produce a partially governed config", (declared) => {
  expect(() => configuredKit(DEFAULT_CONFIG, { roots: declared, terms: "spec/terms.md" })).toThrow(
    /root.*single paths|single paths.*root/,
  );
});
