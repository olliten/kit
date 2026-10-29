import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { Verdict } from "../../core/primitives/verdict.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { digest } from "../../core/readings/fact-keys.js";
import { capabilityModules, testGroups } from "../../core/readings/test-groups.js";
import { testRuns } from "../../core/readings/test-runs.js";
import { ranLines } from "../../core/readings/coverage-report.js";
import { functionsRun } from "../../core/readings/ran-code.js";
import { sharedPath, sharedRefs } from "../../core/readings/shared-passes.js";
import { heldKey, heldKeys, heldPath, holding, loadedBeside, pathUses, verdictKind, verdictOf } from "../../core/readings/verdict-reuse.js";
import { calendar } from "../adapters/calendar.js";
import { compilerWorkspace } from "../adapters/compiler.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { filesystem } from "../adapters/filesystem.js";
import { processes } from "../adapters/processes.js";
import { readRecorder } from "../adapters/read-recorder.mjs";
import { stopwatch } from "../adapters/stopwatch.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { heldState } from "./held-state.js";
import { publishPasses, readSharedPasses } from "./pass-sharing.js";
import { readConfig } from "./read-config.js";
import { readStoredSnapshot } from "./read-snapshot.js";

const TEST = /\.test\.[mc]?[jt]sx?$/;
const CHUNK = 64;
const SKIP = /^(?:node_modules|\..*)$/;

// `kit verify`: run every check the config's `verify` declares, and every test under its tests directories under
// the command of the group its reach selects, except those whose last passing run read only paths that are still
// in the state that run saw. Each run is watched for what it reads, in its processes and theirs, and a pass is
// kept with those states; a failure is never kept. A test command that writes the test's coverage into `{dir}`
// keeps what the test ran with its pass. A test no group takes fails the gate, since it would never run.
// `--fresh` reuses and keeps nothing, and `--plan` says what would run without running it. With `share` declared,
// passes on `origin`'s refs for this runtime join the store before planning, and the run's own are added after;
// sharing that can't happen is said and never fails the gate.
export async function runVerify({ engineRoot, args, cwd }: CommandRequest): Promise<CommandResponse> {
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    const inline = args.find((argument) => argument.startsWith(`--${name}=`));
    return inline !== undefined ? inline.slice(name.length + 3) : index >= 0 ? args[index + 1] : undefined;
  };
  const at = (path: string): string => normalizedPath(path.startsWith("/") ? path : `${cwd}/${path}`);
  const given = option("root");
  const root = given === undefined ? engineRoot : at(given);
  const configPath = option("config") === undefined ? `${engineRoot}/self-config.md` : at(option("config") ?? "");
  const loaded = readConfig(configPath);
  if ("failure" in loaded) return loaded.failure;
  const policy = loaded.config.verify;
  if (policy === undefined)
    return { stdout: "", stderr: `Kit config ${configPath}: declare verify, the gate's checks and tests.\n`, exitCode: 2 };
  const fresh = args.includes("--fresh");
  const started = stopwatch.now();

  const tests: string[] = [];
  const walk = (directory: string): void => {
    let listed;
    try {
      listed = filesystem.entries(`${root}/${directory}`, []);
    } catch {
      return;
    }
    for (const entry of listed) {
      const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
      if (entry.directory && !SKIP.test(entry.name)) walk(path);
      else if (entry.file && TEST.test(entry.name)) tests.push(path);
    }
  };
  const groups = policy.tests ?? [];
  for (const directory of new Set(groups.flatMap((group) => group.under))) walk(directory);
  const store = evidenceStore.directory(root);
  // The snapshot is read once, through the store, and only when a group is chosen by reach or a test's coverage is
  // read against the code it ran; it is let go once neither needs it, so the tests run without it held.
  let read: ReturnType<typeof readStoredSnapshot>["snapshot"] | undefined;
  const snapshot = () =>
    (read ??= readStoredSnapshot(root, loaded.config, { reuse: evidenceStore.at(store), engine: toolchain.engine(engineRoot) }).snapshot);
  const found = [...new Set(tests)].sort();
  const chosen = testGroups(found, groups, groups.some((group) => group.reaching !== undefined || group.capabilities !== undefined) ? snapshot().imports : [], capabilityModules(loaded.config));
  const unassigned = found.filter((test) => !chosen.has(test));
  type Check = { readonly id: string; readonly line: string; readonly test?: string; readonly records?: boolean; readonly group?: number };
  const first: Check[] = [
    ...policy.checks.filter((check) => check.after === undefined).map((check) => ({ id: check.id, line: check.command })),
    ...found.flatMap((test) => {
      const group = chosen.get(test);
      const command = group === undefined ? undefined : groups[group]?.command;
      return group === undefined || command === undefined
        ? []
        : [{ id: `test:${test}`, line: command.replaceAll("{test}", test), test, records: command.includes("{dir}"), group }];
    }),
  ];
  const last: Check[] = policy.checks.filter((check) => check.after === "tests").map((check) => ({ id: check.id, line: check.command }));
  if (!first.some((check) => check.records === true)) read = undefined;

  const runtime = toolchain.runtime(root);
  const kit = toolchain.kit(engineRoot, root);
  const kindOf = (check: Check): string => verdictKind(check.id, check.line, runtime, kit);
  const stateOf = (key: string): string => heldState(root, key);
  const share = fresh || args.includes("--no-share") ? undefined : policy.share;
  const refs = share === undefined ? undefined : sharedRefs(share, runtime, calendar.now());
  const shared = refs === undefined ? undefined : readSharedPasses(root, store, refs);
  // The passes this run kept or reused, as today's shared ref would hold them.
  const passes: { readonly path: string; readonly text: string }[] = [];
  // The outermost functions a test ran in each file its coverage lists.
  const ranIn = (lcov: readonly string[]): Map<string, number[]> => {
    const ran = new Map<string, number[]>();
    for (const { file, lines } of lcov.flatMap(ranLines)) {
      const path = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
      if (!textFiles.exists(`${root}/${path}`)) continue;
      ran.set(path, functionsRun(compilerWorkspace.outermostFunctions(path, textFiles.read(`${root}/${path}`)), lines));
    }
    return ran;
  };
  const plan = (checks: readonly Check[]) => {
    const states = new Map<string, string>();
    return {
      states,
      planned: checks.map((check) => {
        if (fresh) return { check, reused: undefined };
        const verdicts = evidenceStore
          .entries(store, kindOf(check))
          .map(verdictOf)
          .flatMap((verdict) => (verdict === null ? [] : [verdict]));
        for (const verdict of verdicts)
          for (const path of Object.keys(verdict.states))
            if (!states.has(path)) states.set(path, stateOf(path));
        return { check, reused: holding(verdicts, states) };
      }),
    };
  };
  const lines: string[] = [];
  const failures = new Map<string, string>();
  let ran = 0;
  let reused = 0;
  let recorded = 0;
  let unrecorded = 0;
  // A pass is kept only when `keep` holds; a check that reads what the tests kept is not kept on a pass whose
  // tests weren't all kept.
  const run = async (checks: readonly Check[], keep: boolean) => {
    const { planned, states } = plan(checks);
    for (const { check, reused: kept } of planned) {
      if (kept === undefined) continue;
      lines.push(`reused ${check.id}`);
      const text = evidenceStore.read(store, kindOf(check), heldKey(kept));
      if (text !== undefined) passes.push({ path: sharedPath(kindOf(check), heldKey(kept)), text });
    }
    reused += planned.filter((item) => item.reused !== undefined).length;
    const due = planned.filter((item) => item.reused === undefined).map((item) => item.check);
    ran += due.length;
    const namedIn = (directory: string): { name: string; text: string }[] =>
      textFiles.exists(directory)
        ? textFiles
            .entries(directory)
            .filter((entry) => entry.file)
            .map((entry) => ({ name: entry.name, text: textFiles.read(`${directory}/${entry.name}`) }))
        : [];
    const filesIn = (directory: string): string[] => namedIn(directory).map((each) => each.text);
    // What each test ran is read against the code it ran, by the named functions extraction finds in it: read
    // once, before the tests, and kept as only what that needs.
    const code = due.some((check) => check.records === true)
      ? (() => {
          const { files, compiler } = snapshot();
          read = undefined;
          const functions = (compiler?.projects ?? []).flatMap((project) => project.functions ?? []);
          const texts = new Map([...new Set(functions.map((fn) => fn.file))].map((file) => [file, textFiles.read(`${root}/${file}`)]));
          return { files, functions, texts };
        })()
      : undefined;
    // The checks run a chunk at a time, and each chunk's passes are kept and its scratch removed before the next,
    // so a long gate holds one chunk's output and loses at most one chunk if it stops.
    for (let from = 0; from < due.length; from += CHUNK) {
      const chunk = due.slice(from, from + CHUNK);
      const scratch = `${store}/scratch/${digest(`${root}\u0000${stopwatch.now()}\u0000${from}`)}`;
      const directories = chunk.map((_, index) => `${scratch}/${index}`);
      for (const directory of directories) textFiles.directory(`${directory}/runs`);
      // The chunk's start in the file system's own clock: a file changed after it changed while a check ran. A
      // directory's time also moves for an entry made and removed again, as a test runner's bundled config is,
      // so a directory is judged by its listing alone.
      textFiles.write(`${scratch}/started`, "");
      const start = filesystem.modified(`${scratch}/started`) ?? 0;
      const changedSince = (key: string): boolean => {
        const { path, kind } = heldPath(key);
        const at = path === "." ? root : `${root}/${path}`;
        const modified = filesystem.modified(at);
        return !kind && modified !== undefined && modified > start && filesystem.kind(at) === "file";
      };
      // Raw V8 coverage also covers the processes a test starts, such as a launcher it runs.
      const results = await processes.shells(
        chunk.map((check, index) => {
          const directory = directories[index] ?? scratch;
          const coverage = `${directory}/runs`;
          return {
            line: check.test === undefined ? check.line : check.line.replaceAll("{dir}", coverage),
            env: {
              // Added to the options the caller gives Node, such as its certificates, rather than put in their place.
              NODE_OPTIONS: [processes.environment("NODE_OPTIONS"), `--import ${readRecorder.location}`].filter((option) => option !== undefined && option !== "").join(" "),
              KIT_READS: directory,
              KIT_ROOT: root,
              ...(check.records === true ? { NODE_V8_COVERAGE: `${coverage}/v8` } : {}),
            },
          };
        }),
        root,
      );
      const seconds = (stopwatch.now() - started) / 1000;
      chunk.forEach((check, index) => {
        const result = results[index];
        const directory = directories[index] ?? scratch;
        if (result?.status !== 0) {
          lines.push(`failed ${check.id}`);
          const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trimEnd().split("\n").slice(-40).join("\n");
          failures.set(check.id, `${check.id} failed:\n${output}\n`);
          return;
        }
        lines.push(`passed ${check.id}`);
        const lcov = check.records === true ? filesIn(`${directory}/runs`) : [];
        const recordings = namedIn(directory);
        const v8 = check.records === true ? namedIn(`${directory}/runs/v8`) : [];
        // A file another process loaded or ran, such as a child the test starts, ran code the test's coverage
        // doesn't show, so it is kept whole.
        const ran = ranIn(lcov);
        if (check.test !== undefined) for (const path of loadedBeside(recordings, v8, check.test, root)) ran.delete(path);
        const after = new Map(heldKeys(pathUses(recordings.map((each) => each.text)), ran).map((key) => [key, stateOf(key)]));
        // A path that changed while the check ran was read in one state and is kept in another, so the pass
        // describes neither: it is reported and not kept. That is a state other than the one a pass known before
        // the run kept, or, whether or not one was, a change since the chunk started.
        if (!keep || [...after].some(([path, state]) => (states.has(path) && states.get(path) !== state) || changedSince(path))) {
          unrecorded++;
          return;
        }
        const verdict: Verdict = { check: check.id, seconds, states: Object.fromEntries(after) };
        const report =
          check.test !== undefined && check.records === true && code !== undefined
            ? testRuns([{ test: check.test, lcov, v8: v8.map((each) => each.text) }], code.files, root, loaded.config, code.functions, code.texts)[0]
            : undefined;
        const kept: Verdict = report === undefined ? verdict : { ...verdict, ran: report.ran };
        evidenceStore.write(store, kindOf(check), heldKey(kept), JSON.stringify(kept));
        passes.push({ path: sharedPath(kindOf(check), heldKey(kept)), text: JSON.stringify(kept) });
        recorded++;
      });
      textFiles.remove(scratch);
    }
  };

  // With more than one group, a test's line names the group it runs in; a test no group takes is named, not run.
  const named = (check: Check): string => (check.group !== undefined && groups.length > 1 ? `${check.id} in tests[${check.group}]` : check.id);
  const left = unassigned.map((test) => `unassigned test:${test}`);
  if (args.includes("--plan")) {
    const planned = [...plan(first).planned, ...plan(last).planned];
    return {
      stdout: [...planned.map(({ check, reused: kept }) => `${kept === undefined ? "run" : "reuse"} ${named(check)}`), ...left].map((line) => `${line}\n`).join(""),
      stderr: "",
      exitCode: 0,
    };
  }
  await run(first, true);
  // A check declared after the tests, such as one reading what each test ran, runs once their passes are kept.
  await run(last, failures.size === 0 && unrecorded === 0);
  const published =
    refs === undefined || shared === undefined || "failure" in shared ? undefined : publishPasses(root, refs[0], passes, shared);
  evidenceStore.prune(store);
  const failed = lines.filter((line) => line.startsWith("failed ")).length;
  const notes = [
    ...(shared !== undefined && "failure" in shared ? [`Shared no passes: ${shared.failure}\n`] : []),
    ...(published !== undefined && "failure" in published ? [`Published no passes: ${published.failure}\n`] : []),
  ];
  const summary = {
    reused,
    ran,
    failed,
    recorded,
    unrecorded,
    unassigned: unassigned.length,
    shared: { read: shared?.read ?? 0, published: published?.published ?? 0 },
    seconds: (stopwatch.now() - started) / 1000,
  };
  return {
    stdout: `${[...lines, ...left].sort().join("\n")}\n${notes.join("")}Kit verify ${JSON.stringify(summary)}\n`,
    stderr: [...failures.values(), ...unassigned.map((test) => `${test}: no test group takes it, so it never runs.\n`)].join(""),
    exitCode: failed > 0 || unassigned.length > 0 ? 1 : 0,
  };
}
