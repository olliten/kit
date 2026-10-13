// One comment of a source or test file, as written, at the line where it starts.
export interface SnapshotComment {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}
