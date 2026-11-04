import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { describeRefs } from "../../src/core/readings/refs-description.js";
import { moduleClaims } from "../../src/substrate/compositions/refs-run.js";
import { sourceLoader } from "../../src/substrate/adapters/source-loader.mjs";

const engine = resolve(import.meta.dirname, "../..");


test("Kit's oracle module view distinguishes implementation and proof relationships", async () => {
  const result = await moduleClaims(engine, join(engine, "self-config.md"), "oracle/core/readings/fixture-snapshot.ts");
  const claim = result?.claims.find(
    (row: { readonly anchor: string }) => row.anchor === "imports-point-inward",
  );
  expect(claim).toMatchObject({
    implementation: ["dependency-check", "import"],
    proof: ["fixture-snapshot"],
    tests: ["oracle/code-structure/imports-point-inward.test.ts"],
  });
  if (result === null || result === undefined) throw new Error("Kit's self-config names no module claims.");
  if (claim === undefined) throw new Error("imports-point-inward is not among the module's claims.");
  const output = describeRefs({ module: result.module, claims: [claim] });
  expect(output).toContain("Implementation (2): {{dependency-check}}, {{import}}");
  expect(output).toContain("Proof (1): {{fixture-snapshot}}");
});

test("a launcher runs its command only when it is the file node was started with, also through a link", () => {
  const launcher = new URL("../../scripts/kit-refs.mjs", import.meta.url).href;
  expect(sourceLoader.isMain(launcher, join(engine, "scripts/kit-refs.mjs"))).toBe(true);
  expect(sourceLoader.isMain(launcher, join(engine, "scripts/kit-check.mjs"))).toBe(false);
  expect(sourceLoader.isMain(launcher, undefined)).toBe(false);
});
