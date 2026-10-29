import type { Runs } from "../primitives/runs.js";
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
  const ran = parsed["ran"];
  const listed = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (ran !== undefined && !(isRecord(ran) && Object.values(ran).every(listed))) return null;
  return {
    check: parsed["check"],
    seconds: parsed["seconds"],
    states: Object.fromEntries(Object.entries(states).map(([path, state]) => [path, String(state)])),
    ...(isRecord(ran) ? { ran: Object.fromEntries(Object.entries(ran).flatMap(([module, keys]) => (listed(keys) ? [[module, keys]] : []))) } : {}),
  };
}

// Where one check's passes are kept: by its id, its command and the runtime it ran on, so a pass under another
// command, Node or set of installed packages is never taken for this one.
export const verdictKind = (id: string, line: string, runtime: string): string => `verdicts/${digest(JSON.stringify([id, line, runtime]))}`;

// What each test ran, from its pass that still holds, or the tests that have none, while the rules that read
// what tests ran wait for them.
export function keptRuns(passes: ReadonlyMap<string, Verdict | undefined>): { readonly runs: Runs | null; readonly waiting: readonly string[] } {
  const waiting = [...passes].filter(([, pass]) => pass?.ran === undefined).map(([test]) => test).sort();
  if (waiting.length > 0) return { runs: null, waiting };
  return { runs: { tests: Object.fromEntries([...passes].map(([test, pass]) => [test, pass?.ran ?? {}])) }, waiting };
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
