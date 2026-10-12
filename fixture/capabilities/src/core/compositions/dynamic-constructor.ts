export function createCode(code: string): unknown {
  const result: unknown = new Function(code);
  return result;
}
