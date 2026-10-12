export function inspect(key: string): { readonly dynamic: unknown; readonly ambient: number } {
  const dynamic: unknown = Reflect.get(globalThis, key);
  const ambient: number = ambientRead();
  return { dynamic, ambient };
}
