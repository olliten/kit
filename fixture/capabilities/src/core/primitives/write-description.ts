export interface WriteDescription {
  readonly kind: "put-cell";
  readonly key: string;
  readonly value: string;
}
