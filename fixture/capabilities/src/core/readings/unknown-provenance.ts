import { externalValue } from "unsupported-library";

export function valueText(input: { readonly value: string }): string {
  return input.value;
}

export const text: string = valueText(externalValue);
