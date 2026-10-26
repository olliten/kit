// One read of a codebase. Every path is relative to the app root, with "/" separators.
export type FileType = "source" | "test" | "spec" | "other";

export interface SnapshotFile {
  readonly path: string;
  readonly type: FileType;
  // The digest of the file's bytes, for a file the snapshot read.
  readonly digest?: string;
}

// The size of one source file under the source root: how many statements its syntax holds, so formatting,
// braces and semicolons cannot change it, and, for each statement that does nothing but import, re-export or
// call code another file of the app declares, that file.
export interface SourceSize {
  readonly file: string;
  readonly statements: number;
  readonly calls: readonly string[];
}

// The text of one spec file; the terms file's own definition lines are left out.
export interface SpecProse {
  readonly file: string;
  readonly text: string;
}
