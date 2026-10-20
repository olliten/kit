export interface ClaimMarker {
  readonly anchor: string;
  readonly line: number;
  // All named terms, including both explicit module relationships, share one resolution path.
  readonly terms?: readonly string[];
  readonly implementation?: readonly string[];
  readonly proof?: readonly string[];
}

export interface Claim extends ClaimMarker {
  readonly file: string;
}
