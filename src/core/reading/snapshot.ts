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

export interface Snapshot {
  readonly files: readonly SnapshotFile[];
  readonly imports: readonly ImportEdge[];
  readonly headings: readonly SpecHeading[];
  readonly config: KitConfig;
}
