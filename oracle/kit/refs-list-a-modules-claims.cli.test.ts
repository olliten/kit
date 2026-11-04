import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";

const engine = resolve(import.meta.dirname, "../..");
const fixture = join(engine, "examples/tally");
const config = join(fixture, "kit/config.md");
const refs = (args: string[], input?: string): string => {
  const result = processes.run(
    processes.node(),
    [join(engine, "scripts/kit-refs.mjs"), "--root", fixture, "--config", config, ...args],
    undefined,
    input,
  );
  if (result.status !== 0) throw new Error(`kit-refs exited ${String(result.status)}: ${result.stderr}`);
  return result.stdout;
};


test("a module's claims are listed with their topic, text and tests", () => {
  expect(refs(["src/core/primitives/limits.ts"])).toBe(
    [
      "core/primitives/limits keeps 1 claim:",
      "- spec/tally.md#one-step-is-capped: One step adds at most the limit, so the tally never grows past it in one add. {{add}}, {{limits}}",
      "  oracle/tally/one-step-is-capped.test.ts",
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
  expect(read(join(fixture, "kit/config.md"))).toBe("");
  expect(read(join(fixture, "spec/tally.md"))).toBe("");
});
