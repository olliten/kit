import type { CompilerFacts } from "../../../src/core/primitives/compiler-facts.js";
import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { behaviourReading } from "../../../src/substrate/compositions/behaviour-reading.js";
import { contractReading } from "../../../src/substrate/compositions/contract-reading.js";
import { factWalk } from "../../../src/substrate/compositions/fact-walk.js";
import { importRecorder } from "../../../src/substrate/compositions/import-recorder.js";
import { nativeReading } from "../../../src/substrate/compositions/native-reading.js";
import { syntaxReading } from "../../../src/substrate/compositions/syntax-reading.js";
import { openProgram } from "./program-fixture.js";

type Project = CompilerFacts["projects"][number];

// The imports and exports a compiled fixture records, and nothing else of its snapshot.
export function recordedImports(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
): Pick<Project, "files" | "imports" | "exports"> {
  const fixture = openProgram(files, config);
  try {
    const natives = nativeReading(fixture.scope);
    const contracts = contractReading(fixture.scope);
    const recorder = importRecorder(
      fixture.scope,
      fixture.importTarget,
      fixture.ambientTargets,
      syntaxReading(fixture.scope),
      contracts,
      behaviourReading(fixture.scope, natives, contracts),
    );
    factWalk(fixture.scope, [recorder]);
    return { files: fixture.files, imports: recorder.imports, exports: recorder.exports };
  } finally {
    fixture.dispose();
  }
}
