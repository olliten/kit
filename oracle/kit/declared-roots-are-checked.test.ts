import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";

import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };

test("the existing single-root declaration keeps its configuration", () => {
  const config = configuredKit(DEFAULT_CONFIG, { roots, terms: "spec/terms.md" });
  expect([config.srcRoot, config.specRoot, config.oracleRoot]).toEqual(["src", "spec", "oracle"]);
});

test.each([
  { ...roots, src: [] },
  { ...roots, code: ["src/", "oracle/"] },
  { ...roots, extra: "oracle/" },
  { ...roots, src: "" },
])("unsupported root declaration %j cannot produce a partially governed config", (declared) => {
  expect(() => configuredKit(DEFAULT_CONFIG, { roots: declared, terms: "spec/terms.md" })).toThrow(
    /root.*single paths|single paths.*root|roots\.(code|extra) is not a key Kit reads/,
  );
});

test("a root set is normalized without choosing a primary root", () => {
  const declaration = { roots: { ...roots, src: ["src/", "oracle/"] }, terms: "spec/terms.md" };
  const config = configuredKit(DEFAULT_CONFIG, declaration);
  expect(config.srcRoot).toEqual(["oracle", "src"]);
  expect(declaration.roots.src).toEqual(["src/", "oracle/"]);
});
