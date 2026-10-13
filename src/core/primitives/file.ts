// One read of a codebase. Every path is relative to the app root, with "/" separators.
export type FileType = "source" | "test" | "spec" | "other";

export interface SnapshotFile {
  readonly path: string;
  readonly type: FileType;
}

// The text of one spec file; the terms file's own definition lines are left out.
export interface SpecProse {
  readonly file: string;
  readonly text: string;
}
