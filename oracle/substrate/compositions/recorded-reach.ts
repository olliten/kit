import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { type TestReach, testReach } from "../../../src/substrate/compositions/test-reach.js";
import { openProgram } from "./program-fixture.js";

// What one test of a compiled fixture reaches: its code followed into the fixture's sources, as a snapshot
// reads a test's proof.
export function recordedReach(
  files: Readonly<Record<string, string>>,
  test: string,
  config: Partial<KitConfig> = {},
): TestReach {
  const { scope, importTarget } = openProgram(files, config);
  const file = scope.program.getSourceFiles().find((sf) => scope.local(sf.fileName) === test);
  if (file === undefined) throw new Error(`${test} is not in the fixture's program`);
  return testReach(scope.program, scope.checker, new Set([...scope.source, test]), scope.local, importTarget)(file);
}
