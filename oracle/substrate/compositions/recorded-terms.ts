import type { CompilerFacts } from "../../../src/core/primitives/compiler-facts.js";
import type { CompilerOptions } from "typescript";
import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { factWalk } from "../../../src/substrate/compositions/fact-walk.js";
import { syntaxReading } from "../../../src/substrate/compositions/syntax-reading.js";
import { termRecorder } from "../../../src/substrate/compositions/term-recorder.js";
import { openProgram } from "./program-fixture.js";

type Project = CompilerFacts["projects"][number];

// The term facts a compiled fixture records, and nothing else of its snapshot.
export function recordedTerms(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
  compilerOptions: Pick<CompilerOptions, "paths" | "skipLibCheck"> = {},
): Pick<Project, "files" | "termFacts"> {
  const fixture = openProgram(files, config, compilerOptions);
  const recorder = termRecorder(fixture.scope, syntaxReading(fixture.scope));
  factWalk(fixture.scope, [recorder]);
  return { files: fixture.files, termFacts: { sources: recorder.sources, types: recorder.types } };
}
