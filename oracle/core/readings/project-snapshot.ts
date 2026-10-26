import type { CompilerFacts } from "../../../src/core/primitives/compiler-facts.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../../src/core/primitives/snapshot.js";

type Project = CompilerFacts["projects"][number];

// A snapshot holding one strict compiler project of only the given facts, for a check proved on what it reads.
export function projectSnapshot(facts: Partial<Project>, config: Partial<KitConfig> = {}): Snapshot {
  const project: Project = {
    file: "tsconfig.json",
    zone: null,
    settings: { lib: [], types: [], strict: true, noImplicitAny: true, strictNullChecks: true, isolatedDeclarations: true },
    files: [],
    ambientFiles: [],
    diagnostics: [],
    imports: [],
    exports: [],
    globals: [],
    escapes: [],
    parameters: [],
    contracts: [],
    accesses: [],
    constructions: [],
    ...facts,
  };
  return {
    files: project.files.map((path) => ({ path, type: "source" as const })),
    imports: [],
    terms: [],
    prose: [],
    symbols: [],
    comments: [],
    config: { ...DEFAULT_CONFIG, ...config },
    compiler: { version: "", projects: [project] },
  };
}
