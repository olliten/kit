import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { type TestReach, testReach } from "../../../src/substrate/compositions/test-reach.js";
import { openProgram } from "./program-fixture.js";

// Which file's code led into which, for one test of a compiled fixture, as a snapshot reads a test's proof.
export function recordedUses(
  files: Readonly<Record<string, string>>,
  test: string,
  config: Partial<KitConfig> = {},
): TestReach["uses"] {
  const { scope, importTarget } = openProgram(files, config);
  const file = scope.program.getSourceFiles().find((sf) => scope.local(sf.fileName) === test);
  if (file === undefined) throw new Error(`${test} is not in the fixture's program`);
  return testReach(scope.checker, new Set([...scope.source, test]), scope.local, importTarget)(file).uses;
}
