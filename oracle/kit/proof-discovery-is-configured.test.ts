import { expect, test } from "vitest";

const { testRoots } = await import(
  new URL("../../scripts/kit-config.mjs", import.meta.url).href
);

test("an unrelated repository discovers only its own proof directory", () => {
  expect(testRoots({ roots: { oracle: "proofs/" } })).toEqual(["proofs"]);
});

test("legacy discovery is explicit, normalized and does not mutate declarations", () => {
  const declaration = {
    roots: { oracle: "proofs/" },
    "legacy-test-roots": ["old/spec/", "checks", "checks/", "proofs"],
  };
  expect(testRoots(declaration)).toEqual(["old/spec", "checks", "proofs"]);
  expect(declaration["legacy-test-roots"]).toEqual([
    "old/spec/", "checks", "checks/", "proofs",
  ]);
});

test("the proof host's roots are its explicit discovery directories", () => {
  expect(testRoots({
    roots: { oracle: "oracle/" },
    hosts: { proof: { lib: ["node"], roots: ["spec/", "src/", "__tests__/"] } },
  })).toEqual(["spec", "src", "__tests__", "oracle"]);
  expect(() => testRoots({ roots: { oracle: "proofs" }, hosts: { proof: { lib: ["node"], roots: ["../x"] } } })).toThrow();
});

test("a consumer can retain its exact historical discovery directories", () => {
  expect(testRoots({
    roots: { oracle: "oracle/" },
    "legacy-test-roots": ["spec/", "src/", "__tests__/"],
  })).toEqual(["spec", "src", "__tests__", "oracle"]);
});

test.each([null, "spec", {}, 12, false])("legacy roots reject a non-list %j", (legacy) => {
  expect(() => testRoots({ roots: { oracle: "proofs" }, "legacy-test-roots": legacy })).toThrow();
});

test.each([
  undefined, null, "", " ", " proofs", "proofs ", ".", "./proofs", "old/../proofs",
  "../proofs", "/proofs", "C:/proofs", "old\\proofs", "proofs/*", "proofs/?",
  "proofs/[a]", "proofs/{a,b}", "!proofs", 4, {},
])("invalid proof root %j rejects both target and legacy discovery", (path) => {
  expect(() => testRoots({ roots: { oracle: path } })).toThrow();
  expect(() => testRoots({ roots: { oracle: "proofs" }, "legacy-test-roots": [path] })).toThrow();
});
