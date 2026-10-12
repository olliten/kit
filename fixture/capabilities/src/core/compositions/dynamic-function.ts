export function createCode(code: string): unknown {
  const result: unknown = Function(code);
  return result;
}
