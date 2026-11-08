import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { type TestReach, testReach } from "../../../src/substrate/compositions/test-reach.js";
import { openProgram } from "./program-fixture.js";

// What one test of a compiled fixture reaches: its code followed into the fixture's sources, as a snapshot
// reads a test's proof.
export function recordedReach(
  files: Readonly<Record<string, string>>,
  test: string,
  config: Partial<KitConfig> = {},
): Omit<TestReach, "uses"> {
  const { reached, whole, declarations } = followed(files, test, config);
  return { reached, whole, declarations };
}

// Which file's code led into which, for one test of a compiled fixture.
export function recordedUses(
  files: Readonly<Record<string, string>>,
  test: string,
  config: Partial<KitConfig> = {},
): TestReach["uses"] {
  return followed(files, test, config).uses;
}

function followed(files: Readonly<Record<string, string>>, test: string, config: Partial<KitConfig>): TestReach {
  const { scope, importTarget } = openProgram(files, config);
  const file = scope.program.getSourceFiles().find((sf) => scope.local(sf.fileName) === test);
  if (file === undefined) throw new Error(`${test} is not in the fixture's program`);
  const { reached, whole, declarations, uses } = testReach(scope.checker, new Set([...scope.source, test]), scope.local, importTarget)(file);
  return { reached, whole, declarations, uses };
}
