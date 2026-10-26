import type { CompilerFacts } from "../../../src/core/primitives/compiler-facts.js";
import type { KitConfig } from "../../../src/core/primitives/default-config.js";
import { behaviourReading } from "../../../src/substrate/compositions/behaviour-reading.js";
import { contractReading } from "../../../src/substrate/compositions/contract-reading.js";
import { contractRecorder } from "../../../src/substrate/compositions/contract-recorder.js";
import { factWalk } from "../../../src/substrate/compositions/fact-walk.js";
import { nativeReading } from "../../../src/substrate/compositions/native-reading.js";
import { openProgram } from "./program-fixture.js";

type Project = CompilerFacts["projects"][number];

// The contracts and constructions a compiled fixture records, and nothing else of its snapshot.
export function recordedContracts(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
): Pick<Project, "files" | "contracts" | "constructions"> {
  const fixture = openProgram(files, config);
  try {
    const natives = nativeReading(fixture.scope);
    const contracts = contractReading(fixture.scope);
    const recorder = contractRecorder(fixture.scope, natives, contracts, behaviourReading(fixture.scope, natives, contracts));
    factWalk(fixture.scope, [recorder]);
    return { files: fixture.files, contracts: recorder.contracts, constructions: recorder.constructions };
  } finally {
    fixture.dispose();
  }
}
