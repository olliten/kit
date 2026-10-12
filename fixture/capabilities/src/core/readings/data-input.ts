export interface Input {
  readonly value: string;
  readonly options: { readonly trim: boolean };
}

export function transformedValue(input: Input): string {
  return input.options.trim ? input.value.trim() : input.value;
}
