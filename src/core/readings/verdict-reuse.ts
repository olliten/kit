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

// One process's file among a check's recordings or raw coverage, by its name, which holds the process id: a
// recording is `<pid>-<thread>.txt`, a raw V8 coverage file `coverage-<pid>-<time>-<n>.json`.
export interface ProcessFile {
  readonly name: string;
  readonly text: string;
}

const pidOf = (name: string): string | undefined => /^(?:coverage-)?(\d+)-/.exec(name)?.[1];

// The paths a process other than the one that loaded the test loaded or ran, such as a child the test starts: the
// test's coverage describes the process that loaded it, so what another process ran in a file is not in it, and
// the file is kept whole. When no process is seen loading the test, every loaded path is.
export function loadedBeside(recordings: readonly ProcessFile[], coverage: readonly ProcessFile[], test: string, root: string): Set<string> {
  const lines = recordings.map(({ name, text }) => ({ pid: pidOf(name), lines: text.split("\n") }));
  const testers = new Set(lines.filter((each) => each.lines.includes(`load ${test}`)).map((each) => each.pid));
  const beside = new Set<string>();
  for (const each of lines)
    if (!testers.has(each.pid)) for (const line of each.lines) if (line.startsWith("load ")) beside.add(line.slice(5));
  const prefix = `"url":"file://${root}/`;
  for (const { name, text } of coverage) {
    if (testers.has(pidOf(name))) continue;
    for (let at = text.indexOf(prefix); at >= 0; at = text.indexOf(prefix, at + 1)) {
      const end = text.indexOf('"', at + prefix.length);
      if (end > at) beside.add(decodeURIComponent(text.slice(at + prefix.length, end)));
    }
  }
  return beside;
}

// The key a pass holds an installed package under, by its path in the lockfile, such as `node_modules/@a/b`: no
// path in the app is written so.
export const PACKAGE_KEY = "#package:";

const MANIFEST = /(?:^|\/)package\.json$/;

// What a pass depends on in each path, as the key its state is kept under: the path alone for its content (read
// or listed), `#kind` for whether it is absent, a file or a directory (only probed), `#ran:` with the outermost
// functions the run ran for a script only the module loader read, when the run's coverage covers it, and
// `#manifest` for a `package.json` only the module loader or npm read, which read no scripts. An installed
// package the run used is held under `#package:` and its lockfile path. The app's lockfile only the module loader
// read, as Vite does to key its own cache, is held through the packages the run used.
export function heldKeys(uses: ReadonlyMap<string, ReadonlySet<string>>, ran: ReadonlyMap<string, readonly number[]>): string[] {
  return [...uses]
    .flatMap(([path, kinds]) => {
      if (kinds.has("package")) return [`${PACKAGE_KEY}${path}`];
      if (kinds.has("read") || kinds.has("list")) return [path];
      // Only a script's text is read as functions; any other file a coverage lists is held whole.
      const functions = /\.[cm]?[jt]sx?$/.test(path) ? ran.get(path) : undefined;
      if (kinds.has("load")) {
        if (path === "package-lock.json") return [];
        if (MANIFEST.test(path)) return [`${path}#manifest`];
        return [functions === undefined ? path : `${path}#ran:${functions.join(",")}`];
      }
      return [`${path}#kind`];
    })
    .sort();
}

// A kept key's path, and how the path is held: its content, its kind, its content without its scripts, the
// functions a run ran in it, or the installed package it names.
export function heldPath(key: string): {
  readonly path: string;
  readonly kind: boolean;
  readonly ran?: readonly number[];
  readonly manifest?: true;
  readonly package?: string;
} {
  if (key.startsWith(PACKAGE_KEY)) return { path: key, kind: false, package: key.slice(PACKAGE_KEY.length) };
  const mark = key.lastIndexOf("#");
  const mode = mark < 0 ? "" : key.slice(mark + 1);
  if (mode === "kind") return { path: key.slice(0, mark), kind: true };
  if (mode === "manifest") return { path: key.slice(0, mark), kind: false, manifest: true };
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

// How a pass is recorded: the keys its states are kept under, a state's text, a script's ran code and their
// digests, here and in what records them. A pass is kept under this version, not under Kit's source, so a Kit
// release reuses every pass; it changes only when a pass recorded before could be misread after.
export const RECORDING_FORMAT = 2;

// The key a pass holds the source of a Kit outside the app under, when its processes loaded that Kit's code: no
// path in the app is written so.
export const KIT_KEY = "#kit";

// Whether a check's command runs the app's package scripts: through a package manager, which may run a script
// whatever its subcommand, or `node --run`. `npx` runs a package's binary, not a script.
export const runsScripts = (line: string): boolean => /(?:^|[\s;&|(])(?:npm|yarn|pnpm|bun)(?=[\s;&|)]|$)|(?:^|[\s;&|(])node\s[^;&|]*--run\b/.test(line);

// The runtime a check is kept under: the runtime, and the app manifest's scripts for a check that runs them.
export const runtimeOf = (line: string, runtime: string, scripts: string): string =>
  runsScripts(line) ? digest(JSON.stringify([runtime, scripts])) : runtime;

// Where one check's passes are kept: by its id, its command, the runtime it ran on and the recording format, so a
// pass under another command, Node, set of installed packages or format is never taken for this one.
export const verdictKind = (id: string, line: string, runtime: string, format: number = RECORDING_FORMAT): string =>
  `verdicts/${digest(JSON.stringify([id, line, runtime, format]))}`;

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
