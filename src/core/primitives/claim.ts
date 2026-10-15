export interface ClaimMarker {
  readonly anchor: string;
  readonly line: number;
  // The terms the claim names as `{{term}}`; a named module is one that keeps the claim.
  readonly terms?: readonly string[];
}

export interface Claim extends ClaimMarker {
  readonly file: string;
}
