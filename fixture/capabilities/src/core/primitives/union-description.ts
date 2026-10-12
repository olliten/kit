export type UnionDescription =
  | { readonly kind: "put"; readonly value: string }
  | { readonly kind: "remove"; readonly key: string };

export function putDescription(value: string): UnionDescription {
  return { kind: "put", value };
}
