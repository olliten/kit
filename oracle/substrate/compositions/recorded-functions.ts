import type { CompilerOptions } from "typescript";
import type { CompilerFacts } from "../../../src/core/primitives/compiler-facts.js";
import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { factWalk } from "../../../src/substrate/compositions/fact-walk.js";
import { functionRecorder } from "../../../src/substrate/compositions/function-recorder.js";
import { openProgram } from "./program-fixture.js";

type Project = CompilerFacts["projects"][number];

// The named functions a compiled fixture records, and nothing else of its snapshot.
export function recordedFunctions(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
  compilerOptions: Pick<CompilerOptions, "paths" | "skipLibCheck"> = {},
): Pick<Project, "files" | "functions"> {
  const fixture = openProgram(files, config, compilerOptions);
  const recorder = functionRecorder();
  factWalk(fixture.scope, [recorder]);
  return { files: fixture.files, functions: recorder.functions };
}
