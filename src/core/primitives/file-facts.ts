import type { CompilerFacts } from "./compiler-facts.js";
import type { SourceSize } from "./file.js";

type Project = CompilerFacts["projects"][number];

// One file's share of its project's compiler facts, as stored under the key of what they depend on: every
// entry each recorder made while walking the file, the file's own diagnostics, and its size when it is code
// Kit counts.
export interface FileFacts {
  readonly diagnostics: Project["diagnostics"];
  readonly imports: Project["imports"];
  readonly exports: Project["exports"];
  readonly globals: Project["globals"];
  readonly escapes: Project["escapes"];
  readonly parameters: Project["parameters"];
  readonly contracts: Project["contracts"];
  readonly accesses: Project["accesses"];
  readonly constructions: Project["constructions"];
  readonly termSources: NonNullable<Project["termFacts"]>["sources"];
  readonly termTypes: NonNullable<Project["termFacts"]>["types"];
  readonly functions: NonNullable<Project["functions"]>;
  readonly size: SourceSize | null;
}

// One test's reach, as stored under the key of what its code imports.
export type StoredProof = NonNullable<Project["proofs"]>[number];

// A test's reach as stored: its key holds the test and the outlines of what it imports, so the reach also holds
// the digest of each file whose code it followed, and is reused only while each still has it.
export interface StoredReach {
  readonly proof: StoredProof;
  readonly states: Readonly<Record<string, string>>;
}
