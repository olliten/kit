export interface ClaimMarker {
  readonly anchor: string;
  readonly line: number;
}

export interface Claim extends ClaimMarker {
  readonly file: string;
}
