export function first(values: readonly string[]): string {
  return values[0]!;
}

export function capture(value: string): string {
  const match = /^(.*)$/.exec(value);
  if (match === null) return "";
  return match[1]!;
}
