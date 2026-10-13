export interface SemanticReference {
  readonly namespace: "topic" | "term";
  readonly name: string;
  readonly line: number;
}

export interface Reference extends SemanticReference {
  readonly file: string;
}
