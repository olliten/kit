import type { Verdict } from "../primitives/verdict.js";
import { digest } from "./fact-keys.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The paths a check's processes recorded, one per line in each process's file, each once.
export function readPaths(recordings: readonly string[]): string[] {
  return [...new Set(recordings.flatMap((text) => text.split("\n")).filter((line) => line !== ""))].sort();
}

// A stored verdict, or null when its text isn't one, as a torn or foreign entry wouldn't be.
export function verdictOf(text: string): Verdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed["check"] !== "string" || typeof parsed["seconds"] !== "number") return null;
  const states = parsed["states"];
  if (!isRecord(states) || !Object.values(states).every((state) => typeof state === "string")) return null;
  return { check: parsed["check"], seconds: parsed["seconds"], states: Object.fromEntries(Object.entries(states).map(([path, state]) => [path, String(state)])) };
}

// What Kit keeps is kept with the state of every path it was read from: a check's pass, or a test's reach.
type Held = { readonly states: Readonly<Record<string, string>> };

// The entry that still describes the tree: every path it was read from is still in the state it was in. A run
// reads the same paths while their content is the same, so no path it didn't read can change what it found.
export function holding<T extends Held>(entries: readonly T[], states: ReadonlyMap<string, string>): T | undefined {
  return entries.find((entry) => Object.entries(entry.states).every(([path, state]) => states.get(path) === state));
}

// Where an entry is kept among its subject's: one per distinct set of states, so reads of one subject on different
// trees, such as two worktrees' edits, each keep theirs.
export const heldKey = (entry: Held): string => digest(JSON.stringify(Object.entries(entry.states).sort()));
