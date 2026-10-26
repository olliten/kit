import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import { describeRefs } from "../../src/core/readings/refs-description.js";
import { moduleClaims } from "../../src/substrate/compositions/refs-run.js";
import { sourceLoader } from "../../src/substrate/adapters/source-loader.mjs";

const engine = resolve(import.meta.dirname, "../..");
const fixture = join(engine, "fixture");
const scratch = mkdtempSync(join(tmpdir(), "kit-refs-"));
const config = join(scratch, "config.md");
writeFileSync(
  config,
  "```yaml\napp: tally\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\n```\n",
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const refs = (args: string[], input?: string): string =>
  execFileSync(
    process.execPath,
    [join(engine, "scripts/kit-refs.mjs"), "--root", fixture, "--config", config, ...args],
    { encoding: "utf8", ...(input === undefined ? {} : { input }) },
  );

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
  const output = describeRefs({ module: result!.module, claims: [claim!] });
  expect(output).toContain("Implementation (2): {{dependency-check}}, {{import}}");
  expect(output).toContain("Proof (1): {{fixture-snapshot}}");
});

test("a module's claims are listed with their topic, text and tests", () => {
  expect(refs(["src/core/readings/total.ts"])).toBe(
    [
      "core/readings/total keeps 1 claim:",
      "- spec/tally.md#total-holds: The total equals the sum of the supplied amounts. {{tally}}, {{total}}",
      "  oracle/tally/total-holds.test.ts",
      "",
    ].join("\n"),
  );
});

test("a module is found by its name, and a plural module by its singular term", () => {
  expect(refs(["label"])).toContain("- spec/tally.md#screen-shows-the-total:");
  expect(refs(["src/core/primitives/limits.ts"])).toContain("#one-step-is-capped:");
});

test("a module no claim names says so", () => {
  expect(refs(["src/substrate/compositions/save.ts"])).toBe(
    "substrate/compositions/save is named by no claim.\n",
  );
});

test("as a read hook, opening a module adds its claims and opening any other file adds nothing", () => {
  const read = (path: string) => refs(["--hook"], JSON.stringify({ tool_input: { file_path: path } }));
  const output = JSON.parse(read(join(fixture, "src/core/readings/average.ts")));
  expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  expect(output.hookSpecificOutput.additionalContext).toContain("#average-of-amounts:");
  expect(read(join(fixture, "src/main.ts"))).toBe("");
  expect(read(join(fixture, "spec/tally.md"))).toBe("");
});

test("a launcher runs its command only when it is the file node was started with, also through a link", () => {
  const launcher = new URL("../../scripts/kit-refs.mjs", import.meta.url).href;
  expect(sourceLoader.isMain(launcher, join(engine, "scripts/kit-refs.mjs"))).toBe(true);
  expect(sourceLoader.isMain(launcher, join(engine, "scripts/kit-check.mjs"))).toBe(false);
  expect(sourceLoader.isMain(launcher, undefined)).toBe(false);
});
