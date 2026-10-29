import { heldKey, verdictOf } from "./verdict-reuse.js";

const DAY = 24 * 60 * 60 * 1000;
const ENTRY = /^(verdicts\/[0-9a-f]{64})\/([0-9a-f]{64})\.json$/;

// The refs passes are shared on for a runtime at a time: today's, which a run adds to, then yesterday's, so a run
// just after midnight still finds the day's passes. A pass on another runtime is never shared into this one.
export function sharedRefs(prefix: string, runtime: string, now: number): readonly [string, string] {
  const ref = (time: number): string => `${prefix}/${new Date(time).toISOString().slice(0, 10)}-${runtime.slice(0, 16)}`;
  return [ref(now), ref(now - DAY)];
}

// Where a kept pass lies in a shared tree: its kind and key, as the store lays them out without the fan-out.
export const sharedPath = (kind: string, key: string): string => `${kind}/${key}.json`;

// The kind and key in the store of a shared path, or null when the path isn't where a pass lies.
export function sharedPlace(path: string): { readonly kind: string; readonly key: string } | null {
  const match = ENTRY.exec(path);
  return match?.[1] === undefined || match[2] === undefined ? null : { kind: match[1], key: match[2] };
}

// A shared file's kind and key in the store, or null when its path isn't a pass's or its text is not a pass kept
// under that key, as a foreign or torn file wouldn't be.
export function sharedPass(path: string, text: string): { readonly kind: string; readonly key: string } | null {
  const place = sharedPlace(path);
  const verdict = verdictOf(text);
  return place === null || verdict === null || heldKey(verdict) !== place.key ? null : place;
}

// The passes a ref's tree lacks, by path: a pass already at a path stays, since a key names the states it holds.
export function unshared(
  held: readonly string[],
  passes: readonly { readonly path: string; readonly text: string }[],
): { readonly path: string; readonly text: string }[] {
  const present = new Set(held);
  return [...new Map(passes.filter((pass) => !present.has(pass.path)).map((pass) => [pass.path, pass])).values()];
}
