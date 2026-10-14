export type UnionDescription =
  | { readonly kind: "put"; readonly value: string }
  | { readonly kind: "remove"; readonly key: string };
