export function runCode(code: string): unknown {
  const result: unknown = eval(code);
  return result;
}
