export function dynamicValue(key: string): unknown {
  const value: unknown = Reflect.get(globalThis, key);
  return value;
}
