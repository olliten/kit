import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { Verdict } from "../../core/primitives/verdict.js";
import { batchAttribution } from "../../core/readings/batch-attribution.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { digest } from "../../core/readings/fact-keys.js";
import { capabilityModules, testGroups } from "../../core/readings/test-groups.js";
import { testRuns } from "../../core/readings/test-runs.js";
import { ranLines } from "../../core/readings/coverage-report.js";
import { functionsRun } from "../../core/readings/ran-code.js";
import { sharedPath, sharedRefs } from "../../core/readings/shared-passes.js";
import { heldKey, heldKeys, heldPath, holding, loadedBeside, pathUses, runtimeOf, verdictKind, verdictOf } from "../../core/readings/verdict-reuse.js";
import { testLine } from "../../core/readings/verification-configuration.js";
import { calendar } from "../adapters/calendar.js";
import { coverageProvider } from "../adapters/coverage-provider.mjs";
import { evidenceStore } from "../adapters/evidence-store.js";
import { filesystem } from "../adapters/filesystem.js";
import { processes } from "../adapters/processes.js";
import { readRecorder } from "../adapters/read-recorder.mjs";
import { stopwatch } from "../adapters/stopwatch.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { heldStates } from "./held-state.js";
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
// keeps what the test ran with its pass; one whose command takes several tests `{tests}` runs a chunk's tests of
// that group in one invocation. A test no group takes fails the gate, since it would never run.
// `--fresh` reuses and keeps nothing, and `--plan` says what would run without running it. With `share` declared,
// passes on `origin`'s refs for this runtime join the store before planning, and the run's own are added once each
// chunk's are kept; sharing that can't happen is said and never fails the gate.
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
  type Check = {
    readonly id: string;
    readonly line: string;
    readonly test?: string;
    readonly records?: boolean;
    readonly group?: number;
    readonly batch?: boolean;
  };
  const first: Check[] = [
    ...policy.checks.filter((check) => check.after === undefined).map((check) => ({ id: check.id, line: check.command })),
    ...found.flatMap((test) => {
      const group = chosen.get(test);
      const command = group === undefined ? undefined : groups[group]?.command;
      return group === undefined || command === undefined
        ? []
        : [{ id: `test:${test}`, line: testLine(command, test), test, records: command.includes("{dir}"), group, batch: command.includes("{tests}") }];
    }),
  ];
  const last: Check[] = policy.checks.filter((check) => check.after === "tests").map((check) => ({ id: check.id, line: check.command }));
  if (!first.some((check) => check.records === true)) read = undefined;

  const runtime = toolchain.runtime(root);
  const kit = toolchain.kit(engineRoot, root);
  // A check whose command runs package scripts is kept under them besides.
  const scripts = toolchain.scripts(root);
  const kindOf = (check: Check): string => verdictKind(check.id, check.line, runtimeOf(check.line, runtime, scripts));
  // Each path's state is read once per version of it, so tests that share files read each once. A pass that loaded
  // the code of a Kit outside the app also holds that Kit's source.
  const held = heldStates(root, kit);
  const stateOf = (key: string): string => held.state(key);
  // The file system's own time now, as a marker written and removed again tells it.
  const fileTime = (): number => {
    const marker = `${store}/scratch/${digest(`${root}\u0000${stopwatch.now()}\u0000plan`)}`;
    textFiles.directory(marker);
    textFiles.write(`${marker}/now`, "");
    const time = filesystem.version(`${marker}/now`)?.changed ?? -Infinity;
    textFiles.remove(marker);
    return time;
  };
  const share = fresh || args.includes("--no-share") ? undefined : policy.share;
  const refs = share === undefined ? undefined : sharedRefs(share, runtime, calendar.now());
  const shared = refs === undefined ? undefined : readSharedPasses(root, store, refs);
  // The passes this run kept or reused, as today's shared ref would hold them.
  const passes: { readonly path: string; readonly text: string }[] = [];
  // Today's ref as the last reading or addition left it, how many passes were added to it, and why the run stopped
  // adding, if it did. The passes kept so far are added once each chunk's are kept, so a run stopped later has
  // still shared them; after a failure the run adds nothing more.
  let seen = shared === undefined || "failure" in shared ? undefined : { tip: shared.tip, held: shared.held };
  let published = 0;
  let unpublished: string | undefined;
  const publish = (): void => {
    if (refs === undefined || seen === undefined || unpublished !== undefined) return;
    const result = publishPasses(root, refs[0], passes, seen);
    if ("failure" in result) unpublished = result.failure;
    else {
      published += result.published;
      seen = { tip: result.tip, held: result.held };
    }
  };
  // The outermost functions a test ran in each file its coverage lists.
  const ranIn = (lcov: readonly string[]): Map<string, number[]> => {
    const ran = new Map<string, number[]>();
    for (const { file, lines } of lcov.flatMap(ranLines)) {
      const path = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
      const spans = held.functions(path);
      if (spans !== undefined) ran.set(path, functionsRun(spans, lines));
    }
    return ran;
  };
  const plan = (checks: readonly Check[]) => {
    const states = new Map<string, string>();
    if (!fresh) held.since(fileTime());
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
  let alone = 0;
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
    const fail = (check: Check, result: { readonly stdout: string; readonly stderr: string } | undefined): void => {
      lines.push(`failed ${check.id}`);
      const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trimEnd().split("\n").slice(-40).join("\n");
      failures.set(check.id, `${check.id} failed:\n${output}\n`);
    };
    // A group whose command takes several tests `{tests}` runs a chunk's tests in one invocation; every other
    // check runs alone.
    type Job = { readonly checks: Check[]; readonly batch: boolean };
    const jobsOf = (checks: readonly Check[]): Job[] => {
      const jobs: Job[] = [];
      const batches = new Map<number, Check[]>();
      for (const check of checks) {
        const known = check.batch === true && check.group !== undefined ? batches.get(check.group) : undefined;
        if (known !== undefined) known.push(check);
        else {
          const job = { checks: [check], batch: check.batch === true };
          jobs.push(job);
          if (job.batch && check.group !== undefined) batches.set(check.group, job.checks);
        }
      }
      return jobs;
    };
    // The checks run a chunk at a time, and each chunk's passes are kept and its scratch removed before the next,
    // so a long gate holds one chunk's output and loses at most one chunk if it stops. A test of a batch whose
    // reads can't be told apart runs again alone, once the batch has ended.
    for (let from = 0; from < due.length; from += CHUNK) {
      for (let jobs = jobsOf(due.slice(from, from + CHUNK)), round = 0; jobs.length > 0; round++) {
        const scratch = `${store}/scratch/${digest(`${root}\u0000${stopwatch.now()}\u0000${from}\u0000${round}`)}`;
        const directories = jobs.map((_, index) => `${scratch}/${index}`);
        for (const directory of directories) textFiles.directory(`${directory}/runs`);
        // The round's start in the file system's own clock: a file changed after it changed while a check ran. A
        // directory's time also moves for an entry made and removed again, as a test runner's bundled config is,
        // so a directory is judged by its listing alone.
        textFiles.write(`${scratch}/started`, "");
        const start = filesystem.modified(`${scratch}/started`) ?? 0;
        held.since(filesystem.version(`${scratch}/started`)?.changed ?? -Infinity);
        // An installed package is held by its lockfile entry, so it changed when the lockfile did.
        const changedSince = (key: string): boolean => {
          const { path: named, kind, package: installed } = heldPath(key);
          const path = installed === undefined ? named : "package-lock.json";
          const at = path === "." ? root : `${root}/${path}`;
          const modified = filesystem.modified(at);
          return !kind && modified !== undefined && modified > start && filesystem.kind(at) === "file";
        };
        // A passing check is kept with the state of every path it used, and a test with what it ran. A file
        // another process than the test's loaded or ran, such as a child the test starts, ran code the test's
        // coverage doesn't show, so it is kept whole.
        const settle = (
          check: Check,
          seconds: number,
          uses: ReadonlyMap<string, ReadonlySet<string>>,
          beside: ReadonlySet<string>,
          lcov: readonly string[],
          v8: readonly string[],
        ): void => {
          lines.push(`passed ${check.id}`);
          const ran = ranIn(lcov);
          for (const path of beside) ran.delete(path);
          const after = new Map(heldKeys(uses, ran).map((key) => [key, stateOf(key)]));
          // A path that changed while the check ran was read in one state and is kept in another, so the pass
          // describes neither: it is reported and not kept. That is a state other than the one a pass known before
          // the run kept, or, whether or not one was, a change since the round started.
          if (!keep || [...after].some(([path, state]) => (states.has(path) && states.get(path) !== state) || changedSince(path))) {
            unrecorded++;
            return;
          }
          const verdict: Verdict = { check: check.id, seconds, states: Object.fromEntries(after) };
          const report =
            check.test !== undefined && check.records === true && code !== undefined
              ? testRuns([{ test: check.test, lcov, v8 }], code.files, root, loaded.config, code.functions, code.texts)[0]
              : undefined;
          const kept: Verdict = report === undefined ? verdict : { ...verdict, ran: report.ran };
          evidenceStore.write(store, kindOf(check), heldKey(kept), JSON.stringify(kept));
          passes.push({ path: sharedPath(kindOf(check), heldKey(kept)), text: JSON.stringify(kept) });
          recorded++;
        };
        // Raw V8 coverage also covers the processes a test starts, such as a launcher it runs.
        const results = await processes.shells(
          jobs.map(({ checks, batch }, index) => {
            const directory = directories[index] ?? scratch;
            const coverage = `${directory}/runs`;
            const [check] = checks;
            const tests = checks.flatMap((each) => (each.test === undefined ? [] : [each.test]));
            const command = check?.group === undefined ? undefined : groups[check.group]?.command;
            if (batch) textFiles.write(`${scratch}/${index}.tests`, tests.map((test) => `${test}\n`).join(""));
            return {
              line:
                batch && command !== undefined
                  ? command.replaceAll("{tests}", tests.join(" ")).replaceAll("{dir}", coverage).replaceAll("{provider}", coverageProvider.location)
                  : check === undefined || check.test === undefined
                    ? (check?.line ?? "")
                    : check.line.replaceAll("{dir}", coverage),
              env: {
                // Added to the options the caller gives Node, such as its certificates, rather than put in their place.
                NODE_OPTIONS: [processes.environment("NODE_OPTIONS"), `--import ${readRecorder.location}`].filter((option) => option !== undefined && option !== "").join(" "),
                KIT_READS: directory,
                KIT_ROOT: root,
                // The Kit running the gate: its files are recorded as the app's when it is installed among the
                // app's packages, and its loaded code is marked when it is outside the app.
                KIT_ENGINE: engineRoot,
                KIT_TESTS: batch ? `${scratch}/${index}.tests` : "",
                KIT_TEST: "",
                ...(check?.records === true ? { NODE_V8_COVERAGE: `${coverage}/v8` } : {}),
              },
            };
          }),
          root,
        );
        const seconds = (stopwatch.now() - started) / 1000;
        const again: Check[] = [];
        jobs.forEach(({ checks, batch }, index) => {
          const result = results[index];
          const directory = directories[index] ?? scratch;
          const coverage = `${directory}/runs`;
          const [check] = checks;
          if (!batch) {
            if (check === undefined) return;
            if (result?.status !== 0) return fail(check, result);
            const lcov = check.records === true ? filesIn(coverage) : [];
            const recordings = namedIn(directory);
            const v8 = check.records === true ? namedIn(`${coverage}/v8`) : [];
            const beside = check.test === undefined ? new Set<string>() : loadedBeside(recordings, v8, check.test, root);
            return settle(check, seconds, pathUses(recordings.map((each) => each.text)), beside, lcov, v8.map((each) => each.text));
          }
          const own = (test: string, file: string): string | undefined => {
            const path = `${coverage}/${encodeURIComponent(test)}/${file}`;
            return textFiles.exists(path) ? textFiles.read(path) : undefined;
          };
          const tests = checks.flatMap((each) => (each.test === undefined ? [] : [each.test]));
          const outcomes = batchAttribution(
            {
              tests,
              status: result?.status ?? null,
              recordings: filesIn(directory),
              summary: textFiles.exists(`${coverage}/batch.json`) ? textFiles.read(`${coverage}/batch.json`) : undefined,
              runs: new Map(
                tests.flatMap((test): [string, string][] => {
                  const text = own(test, "run.json");
                  return text === undefined ? [] : [[test, text]];
                }),
              ),
            },
            root,
          );
          // The runner's own raw coverage is every test's; a test's process's children write theirs apart.
          const runner = filesIn(`${coverage}/v8`);
          for (const outcome of outcomes) {
            const each = checks.find((item) => item.test === outcome.test);
            if (each === undefined) continue;
            if (outcome.outcome === "passed") {
              const lcov = own(outcome.test, "lcov.info");
              const children = namedIn(`${coverage}/v8/${encodeURIComponent(outcome.test)}`);
              const beside = loadedBeside([], children, outcome.test, root);
              settle(each, seconds, outcome.uses, beside, lcov === undefined ? [] : [lcov], [...runner, ...children.map((child) => child.text)]);
            } else if (outcome.outcome === "failed") fail(each, result);
            else again.push(each);
          }
        });
        textFiles.remove(scratch);
        alone += again.length;
        jobs = again.map((check) => ({ checks: [check], batch: true }));
      }
      publish();
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
  // What reuse alone kept, with no chunk run after it, is added now.
  publish();
  evidenceStore.prune(store);
  const failed = lines.filter((line) => line.startsWith("failed ")).length;
  const notes = [
    ...(shared !== undefined && "failure" in shared ? [`Shared no passes: ${shared.failure}\n`] : []),
    ...(unpublished === undefined ? [] : [`Published no ${published > 0 ? "more " : ""}passes: ${unpublished}\n`]),
  ];
  const summary = {
    reused,
    ran,
    failed,
    recorded,
    unrecorded,
    alone,
    unassigned: unassigned.length,
    shared: { read: shared?.read ?? 0, published },
    states: { ...held.receipt },
    seconds: (stopwatch.now() - started) / 1000,
  };
  return {
    stdout: `${[...lines, ...left].sort().join("\n")}\n${notes.join("")}Kit verify ${JSON.stringify(summary)}\n`,
    stderr: [...failures.values(), ...unassigned.map((test) => `${test}: no test group takes it, so it never runs.\n`)].join(""),
    exitCode: failed > 0 || unassigned.length > 0 ? 1 : 0,
  };
}
