function value(input: string | undefined): string | undefined {
  return input;
}

export function text(input: string | undefined): string {
  return value(input)!;
}
