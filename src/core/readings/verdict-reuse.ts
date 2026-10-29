import type { Runs } from "../primitives/runs.js";
import type { Verdict } from "../primitives/verdict.js";
import { digest } from "./fact-keys.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// How a check's processes used each path, from their recordings: each line is a use (read, list, probe or load)
// and a path.
export function pathUses(recordings: readonly string[]): Map<string, Set<string>> {
  const uses = new Map<string, Set<string>>();
  for (const line of recordings.flatMap((text) => text.split("\n"))) {
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const path = line.slice(space + 1);
    uses.set(path, new Set([...(uses.get(path) ?? []), line.slice(0, space)]));
  }
  return uses;
}

// What a pass depends on in each path, as the key its state is kept under: the path alone for its content (read
// or listed), `#kind` for whether it is absent, a file or a directory (only probed), and `#ran:` with the
// outermost functions the run ran for a file only the module loader read, when the run's coverage covers it.
export function heldKeys(uses: ReadonlyMap<string, ReadonlySet<string>>, ran: ReadonlyMap<string, readonly number[]>): string[] {
  return [...uses]
    .map(([path, kinds]) => {
      if (kinds.has("read") || kinds.has("list")) return path;
      const functions = ran.get(path);
      if (kinds.has("load")) return functions === undefined ? path : `${path}#ran:${functions.join(",")}`;
      return `${path}#kind`;
    })
    .sort();
}

// A kept key's path, and how the path is held: its content, its kind, or the functions a run ran in it.
export function heldPath(key: string): { readonly path: string; readonly kind: boolean; readonly ran?: readonly number[] } {
  const mark = key.lastIndexOf("#");
  const mode = mark < 0 ? "" : key.slice(mark + 1);
  if (mode === "kind") return { path: key.slice(0, mark), kind: true };
  if (mode.startsWith("ran:")) {
    const listed = mode.slice(4);
    return { path: key.slice(0, mark), kind: false, ran: listed === "" ? [] : listed.split(",").map(Number) };
  }
  return { path: key, kind: false };
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
