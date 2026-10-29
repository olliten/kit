// One function no other function holds: the range of its body in the file's text and the lines it spans.
export interface FunctionSpan {
  readonly body: readonly [number, number];
  readonly lines: readonly [number, number];
}
