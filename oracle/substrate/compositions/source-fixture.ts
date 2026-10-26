import type { CompilerOptions } from "typescript";
import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import { readSnapshot } from "../../../src/substrate/compositions/read-snapshot.js";
import { temporaryProjects } from "../adapters/temporary-project.js";
import { fixtureFiles } from "../../core/readings/fixture-files.js";

export function sourceFixture(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
  compilerOptions: Pick<CompilerOptions, "paths" | "skipLibCheck"> = {},
) {
  const project = temporaryProjects.open("kit-zone-boundary-");
  try {
    project.write(fixtureFiles(files, config, compilerOptions));
    return readSnapshot(project.root, { ...DEFAULT_CONFIG, ...config });
  } finally {
    project.dispose();
  }
}
