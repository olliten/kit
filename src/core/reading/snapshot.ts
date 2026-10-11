import type { KitConfig } from "../data/default-config.js";

// One read of a codebase. Every path is relative to the app root, with "/" separators.
export type FileType = "source" | "test" | "spec" | "other";

export interface SnapshotFile {
  readonly path: string;
  readonly type: FileType;
}

// An import between two files of the snapshot (package imports are not recorded).
export interface ImportEdge {
  readonly from: string;
  readonly to: string;
}

// A spec heading `### <zone>/<kind>/<name>`: `name` is the artifact path, `file` the topic file.
export interface SpecHeading {
  readonly file: string;
  readonly name: string;
}

// A line `- **<term>** — <meaning>` of the terms file, optionally ending `Retired: <word>, <word>.`:
// the retired words this term replaces. `line` is 1-based.
export interface SpecTerm {
  readonly term: string;
  readonly meaning: string;
  readonly retired: readonly string[];
  readonly line: number;
}

// The text of one spec file; the terms file's own definition lines are left out.
export interface SpecProse {
  readonly file: string;
  readonly text: string;
}

// A name a source file exports: `export function|const|class|type|interface <name>`.
export interface ExportedSymbol {
  readonly file: string;
  readonly name: string;
}

// One comment of a source or test file, as written, at the line where it starts.
export interface SnapshotComment {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface Snapshot {
  readonly files: readonly SnapshotFile[];
  readonly imports: readonly ImportEdge[];
  readonly headings: readonly SpecHeading[];
  readonly terms: readonly SpecTerm[];
  readonly prose: readonly SpecProse[];
  readonly symbols: readonly ExportedSymbol[];
  readonly comments: readonly SnapshotComment[];
  readonly config: KitConfig;
}
