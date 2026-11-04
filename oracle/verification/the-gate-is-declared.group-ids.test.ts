import { expect, test } from "vitest";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";

const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
const group = { command: "node {test}", under: "tests/" };

test("named groups retain distinct optional IDs while legacy unnamed groups remain unchanged", () => {
  const config = configuredKit(DEFAULT_CONFIG, { roots, verify: { checks: [], tests: [
    { ...group, id: "browser" }, { ...group, id: "headless" }, group,
  ] } });
  expect(config.verify?.tests).toEqual([
    { ...group, under: ["tests"], id: "browser" },
    { ...group, under: ["tests"], id: "headless" },
    { ...group, under: ["tests"] },
  ]);
});

test.each(["", " ", null, 1, false])("a malformed group ID %j fails configuration", (id) => {
  expect(() => configuredKit(DEFAULT_CONFIG, { roots, verify: { checks: [], tests: [{ ...group, id }] } }))
    .toThrow(/verify.tests/);
});

test("duplicate group IDs fail instead of ambiguously choosing a group to defer", () => {
  expect(() => configuredKit(DEFAULT_CONFIG, { roots, verify: { checks: [], tests: [
    { ...group, id: "browser" }, group, { ...group, id: "browser" },
  ] } })).toThrow(/verify.tests/);
});
