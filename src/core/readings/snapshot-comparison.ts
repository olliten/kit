// Two snapshots are the same when their graphs are, without expanding shared references into JSON text. The
// compiler numbers well-known symbols per process, so names differing only in that number are the same.
export function sameSnapshot(first: unknown, second: unknown): boolean {
  const pairs = new WeakMap<object, WeakSet<object>>();
  const name = (value: string): string => value.replace(/^__@([\w$]+)@\d+$/, "__@$1");
  const entries = (value: object): [string, unknown][] =>
    Object.entries(value).filter(([, item]) => item !== undefined);
  const same = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a === "string" && typeof b === "string") return name(a) === name(b);
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
    const known = pairs.get(a);
    if (known?.has(b)) return true;
    if (known) known.add(b);
    else pairs.set(a, new WeakSet([b]));
    const left = entries(a);
    const right = entries(b);
    return (
      left.length === right.length &&
      left.every(([key, value], index) => {
        const other = right[index];
        return other !== undefined && name(key) === name(other[0]) && same(value, other[1]);
      })
    );
  };
  return same(first, second);
}
