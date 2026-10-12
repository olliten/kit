export interface WriteDescription {
  readonly kind: "put-cell";
  readonly key: string;
  readonly value: string;
}

export function writeDescription(key: string, value: string): WriteDescription {
  return { kind: "put-cell", key, value };
}
