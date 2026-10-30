// One piece of a file's code, in source order: a token or a comment, with its range in the text and whether a
// line break comes before it since the last token, which can change what the code means.
export interface CodeToken {
  readonly at: readonly [number, number];
  readonly text: string;
  readonly comment: boolean;
  readonly line: boolean;
}
