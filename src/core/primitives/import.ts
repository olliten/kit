// An import between two files of the snapshot (package imports are not recorded).
export interface ImportEdge {
  readonly from: string;
  readonly to: string;
}
