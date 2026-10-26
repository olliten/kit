import type { CompilerFacts } from "../../../src/core/primitives/compiler-facts.js";
import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { escapeRecorder } from "../../../src/substrate/compositions/escape-recorder.js";
import { factWalk } from "../../../src/substrate/compositions/fact-walk.js";
import { openProgram } from "./program-fixture.js";

type Project = CompilerFacts["projects"][number];

// The escape hatches a compiled fixture records, and nothing else of its snapshot.
export function recordedEscapes(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
): Pick<Project, "files" | "escapes"> {
  const fixture = openProgram(files, config);
  try {
    const recorder = escapeRecorder();
    factWalk(fixture.scope, [recorder]);
    return { files: fixture.files, escapes: recorder.escapes };
  } finally {
    fixture.dispose();
  }
}
