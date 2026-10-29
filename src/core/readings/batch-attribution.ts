import { pathUses } from "./verdict-reuse.js";

// What one runner invocation over several test files left: its exit status, each process's recording, the
// coverage provider's summary of the run, if it wrote one, and for each test it wrote one for, the test's
// `run.json`: its result and the scripts it executed, absolutely, or null when its coverage couldn't be told
// apart.
export interface BatchOutput {
  readonly tests: readonly string[];
  readonly status: number | null;
  readonly recordings: readonly string[];
  readonly summary: string | undefined;
  readonly runs: ReadonlyMap<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsed = (text: string | undefined): unknown => {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

// A test's result and executed scripts from its `run.json`, or nothing when the text isn't one.
const runOf = (text: string | undefined): { readonly state: string | undefined; readonly scripts: readonly string[] | undefined } => {
  const value = parsed(text);
  const state = isRecord(value) ? value["state"] : undefined;
  const scripts = isRecord(value) ? value["scripts"] : undefined;
  return {
    state: typeof state === "string" ? state : undefined,
    scripts: Array.isArray(scripts) && scripts.every((file) => typeof file === "string") ? scripts.map(String) : undefined,
  };
};

// A test of a batch: it passed, with every path it used and how; it failed; or which of the batch's reads are its
// own is unclear, so it runs again alone.
export type BatchOutcome =
  | { readonly test: string; readonly outcome: "passed"; readonly uses: ReadonlyMap<string, ReadonlySet<string>> }
  | { readonly test: string; readonly outcome: "failed" | "alone" };

const RUNS = "test ";
const UNDER = "under ";
const PASSED = new Set(["pass", "skip", "todo"]);

// Each test's outcome and uses. A recording that names one test of the batch is that test's: its process, or one
// that process started, ran it alone, and what a process it started loaded is kept whole. A recording naming none is the runner's own, whose reads, listings and
// probes serve every test, so each test keeps them, except a use of another test of the batch, which the runner
// made because it was given that test; its loads are each test's whose coverage shows it executed the file, and
// every test's when no test's does. A test keeps every file its coverage shows it executed as
// loaded. A test passes when its result does and its coverage, and a recording, name it alone; a failed test
// fails alone; a test a recording shares with another, or that the provider couldn't tell apart, runs alone, as
// every test does when the runner failed without a test failing or counted errors no test holds. A batch of one
// is that test's run, as a run of one test file is.
export function batchAttribution({ tests, status, recordings, summary, runs: written }: BatchOutput, root: string): BatchOutcome[] {
  const inside = (file: string): string | undefined => {
    const path = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : undefined;
    return path === undefined || path.startsWith("node_modules/") || path.includes("/node_modules/") || path.startsWith(".git/") ? undefined : path;
  };
  const batch = new Set(tests);
  const alone = tests.length === 1;
  const own = new Map<string, string[]>();
  const shared: string[] = [];
  const unclear = new Set<string>();
  const marked = new Set<string>();
  for (const recording of recordings) {
    const lines = recording.split("\n");
    const runs = lines.filter((line) => line.startsWith(RUNS)).map((line) => line.slice(RUNS.length));
    const under = lines.filter((line) => line.startsWith(UNDER)).map((line) => line.slice(UNDER.length));
    // A process the test's process started ran code its coverage doesn't describe, so what it loaded is kept whole,
    // as a read is.
    const text = lines
      .filter((line) => !line.startsWith(RUNS) && !line.startsWith(UNDER))
      .map((line) => (under.length > 0 && line.startsWith("load ") ? `read ${line.slice(5)}` : line))
      .join("\n");
    const [test, ...more] = [...new Set([...runs, ...under])].filter((each) => batch.has(each));
    if (test === undefined || alone) shared.push(text);
    else if (more.length > 0) for (const each of [test, ...more]) unclear.add(each);
    else {
      if (runs.includes(test)) marked.add(test);
      own.set(test, [...(own.get(test) ?? []), text]);
    }
  }
  const runs = new Map(tests.map((test) => [test, runOf(written.get(test))]));
  const counted = parsed(summary);
  const errors = isRecord(counted) && typeof counted["errors"] === "number" ? counted["errors"] : undefined;
  const executed = new Map(tests.map((test) => [test, (runs.get(test)?.scripts ?? []).flatMap((file) => inside(file) ?? [])]));
  const anyExecuted = new Set([...executed.values()].flat());
  const runner = pathUses(shared);
  const failedAny = tests.some((test) => runs.get(test)?.state === "fail");
  const runnerFailed = !alone && (errors !== 0 || (status !== 0 && !failedAny));
  return tests.map((test) => {
    const run = runs.get(test);
    if (alone ? status !== 0 : run?.state === "fail") return { test, outcome: "failed" };
    if (!alone && (runnerFailed || !PASSED.has(run?.state ?? "") || run?.scripts === undefined || !marked.has(test) || unclear.has(test)))
      return { test, outcome: "alone" };
    const uses = pathUses(own.get(test) ?? []);
    const add = (path: string, kind: string): void => {
      uses.set(path, new Set([...(uses.get(path) ?? []), kind]));
    };
    for (const [path, kinds] of runner)
      for (const kind of kinds) if ((path === test || !batch.has(path)) && (kind !== "load" || !anyExecuted.has(path))) add(path, kind);
    for (const path of executed.get(test) ?? []) add(path, "load");
    return { test, outcome: "passed", uses };
  });
}
