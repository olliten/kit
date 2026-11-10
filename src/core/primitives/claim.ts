export interface ClaimMarker {
  readonly anchor: string;
  readonly line: number;
  // All named terms, including both explicit module relationships, share one resolution path.
  readonly terms?: readonly string[];
  readonly implementation?: readonly string[];
  readonly proof?: readonly string[];
  // A declaration's text as offset ranges into the Markdown it was read from, in source order, so a reader takes a
  // claim's words without parsing the claim grammar a second time. References carry none.
  readonly text?: readonly (readonly [start: number, end: number])[];
}

export interface Claim extends ClaimMarker {
  readonly file: string;
}
