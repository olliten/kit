export interface Input {
  readonly value: string;
  readonly options: {
    readonly transform: (value: string) => string;
  };
}

export function transformedValue(input: Input): string {
  return input.options.transform(input.value);
}
