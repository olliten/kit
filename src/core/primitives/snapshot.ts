import type { Claim } from "./claim.js";
import type { SnapshotComment } from "./comment.js";
import type { CompilerFacts } from "./compiler-facts.js";
import type { KitConfig } from "./default-config.js";
import type { ExportedSymbol } from "./exported-symbol.js";
import type { SnapshotFile, SourceSize, SpecProse } from "./file.js";
import type { ImportEdge } from "./import.js";
import type { Reference } from "./reference.js";
import type { Runs } from "./runs.js";
import type { SpecTerm, TermSyntaxIssue } from "./term.js";

export interface Snapshot {
  readonly termSyntax?: readonly TermSyntaxIssue[];
  // Terms out of alphabetical order in the terms file.
  readonly termOrder?: readonly TermSyntaxIssue[];
  readonly semanticReferences?: readonly Reference[];
  readonly claims?: readonly Claim[];
  readonly claimReferences?: readonly Claim[];
  readonly files: readonly SnapshotFile[];
  readonly sizes?: readonly SourceSize[];
  readonly imports: readonly ImportEdge[];
  readonly terms: readonly SpecTerm[];
  readonly prose: readonly SpecProse[];
  readonly symbols: readonly ExportedSymbol[];
  readonly comments: readonly SnapshotComment[];
  readonly config: KitConfig;
  readonly compiler?: CompilerFacts;
  // What each test under the proof root ran, when the app's test command keeps it and every such test has a
  // pass that still holds; the rules that read it wait otherwise.
  readonly runs?: Runs;
}
