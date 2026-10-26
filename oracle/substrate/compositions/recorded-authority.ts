import type { CompilerFacts } from "../../../src/core/primitives/compiler-facts.js";
import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { authorityRecorder } from "../../../src/substrate/compositions/authority-recorder.js";
import { behaviourReading } from "../../../src/substrate/compositions/behaviour-reading.js";
import { contractReading } from "../../../src/substrate/compositions/contract-reading.js";
import { factWalk } from "../../../src/substrate/compositions/fact-walk.js";
import { nativeReading } from "../../../src/substrate/compositions/native-reading.js";
import { syntaxReading } from "../../../src/substrate/compositions/syntax-reading.js";
import { openProgram } from "./program-fixture.js";

type Project = CompilerFacts["projects"][number];

// The parameters, accesses and globals a compiled fixture records, and nothing else of its snapshot.
export function recordedAuthority(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
): Pick<Project, "files" | "parameters" | "accesses" | "globals"> {
  const fixture = openProgram(files, config);
  try {
    const natives = nativeReading(fixture.scope);
    const contracts = contractReading(fixture.scope);
    const recorder = authorityRecorder(
      fixture.scope,
      fixture.workerGlobals,
      syntaxReading(fixture.scope),
      natives,
      behaviourReading(fixture.scope, natives, contracts),
    );
    factWalk(fixture.scope, [recorder]);
    return {
      files: fixture.files,
      parameters: [...recorder.parameters.values()],
      accesses: recorder.accesses,
      globals: recorder.globals,
    };
  } finally {
    fixture.dispose();
  }
}
