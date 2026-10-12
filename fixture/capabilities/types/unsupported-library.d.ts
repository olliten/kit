declare module "unsupported-library" {
  export const externalValue: { readonly value: string };
  export function externalUse(read: () => number): number;
}

declare function ambientRead(): number;
