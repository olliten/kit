import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";

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
