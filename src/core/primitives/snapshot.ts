import type { Claim } from "./claim.js";
import type { SnapshotComment } from "./comment.js";
import type { CompilerFacts } from "./compiler-facts.js";
import type { KitConfig } from "./default-config.js";
import type { ExportedSymbol } from "./exported-symbol.js";
import type { SnapshotFile, SpecProse } from "./file.js";
import type { ImportEdge } from "./import.js";
import type { Reference } from "./reference.js";
import type { SpecTerm, TermSyntaxIssue } from "./term.js";

export interface Snapshot {
  readonly termSyntax?: readonly TermSyntaxIssue[];
  // Terms out of alphabetical order in the terms file.
  readonly termOrder?: readonly TermSyntaxIssue[];
  readonly semanticReferences?: readonly Reference[];
  readonly claims?: readonly Claim[];
  readonly claimReferences?: readonly Claim[];
  readonly files: readonly SnapshotFile[];
  readonly imports: readonly ImportEdge[];
  readonly terms: readonly SpecTerm[];
  readonly prose: readonly SpecProse[];
  readonly symbols: readonly ExportedSymbol[];
  readonly comments: readonly SnapshotComment[];
  readonly config: KitConfig;
  readonly compiler?: CompilerFacts;
}
