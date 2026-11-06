import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { Verdict } from "../../core/primitives/verdict.js";
import type { InvocationEvidence } from "../../core/primitives/invocation-evidence.js";
import type { ExecutionContext } from "../../core/primitives/runs.js";
import { deferredGroupSelection, verificationSelection } from "../../core/readings/verification-selection.js";
import { executionContext, executionContextOf } from "../../core/readings/execution-context.js";
import { invocationIdentity, invocationText } from "../../core/readings/invocation-passes.js";
import { batchAttribution } from "../../core/readings/batch-attribution.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { digest } from "../../core/readings/fact-keys.js";
import { chunkWeight, schedule } from "../../core/readings/command-schedule.js";
import { capabilityModules, testGroups } from "../../core/readings/test-groups.js";
import { testRuns } from "../../core/readings/test-runs.js";
import { ranLines } from "../../core/readings/coverage-report.js";
import { functionsRun } from "../../core/readings/ran-code.js";
import { sharedPath, sharedRefs } from "../../core/readings/shared-passes.js";
import { appPath, heldKey, heldKeys, heldPath, holding, loadedBeside, pathUses, runtimeOf, verdictKind, verdictOf } from "../../core/readings/verdict-reuse.js";
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
// that group in one invocation. Commands run within the declared capacity, a chunk starting while another
// finishes, and a check once the checks it needs have passed. A test no group takes fails the gate, since it
// would never run.
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
    (read ??= readStoredSnapshot(root, loaded.config, { reuse: evidenceStore.at(store), engine: toolchain.extraction(engineRoot) }).snapshot);
  const found = [...new Set(tests)].sort();
  let selection: ReturnType<typeof verificationSelection>;
  let deferredGroup: string | undefined;
  try {
    const path = option("selection");
    const groupOptions = args.flatMap((argument, index) => argument === "--defer-group"
      ? [args[index + 1]]
      : argument.startsWith("--defer-group=") ? [argument.slice("--defer-group=".length)] : []);
    const [id] = groupOptions;
    if (groupOptions.length > 1 || (groupOptions.length === 1 && (id === undefined || !id.trim())))
      throw new Error("defer-group: supply one declared group id, once.");
    deferredGroup = id;
    if (deferredGroup !== undefined && args.some((argument) => argument === "--selection" || argument.startsWith("--selection=")))
      throw new Error("defer-group: cannot combine group deferral with an explicit selection.");
    if (deferredGroup !== undefined && !groups.some((group) => group.id === deferredGroup))
      throw new Error(`defer-group: no declared group has id ${deferredGroup}.`);
    if (args.includes("--selection") && (path === undefined || path.startsWith("--"))) throw new Error("selection: supply its JSON file.");
    selection = verificationSelection(path === undefined ? undefined : JSON.parse(textFiles.read(at(path))), found);
  } catch (error) {
    return { stdout: "", stderr: `${String(error)}\n`, exitCode: 2 };
  }
  const chosen = testGroups(found, groups, groups.some((group) => group.reaching !== undefined || group.capabilities !== undefined) ? snapshot().imports : [], capabilityModules(loaded.config));
  if (deferredGroup !== undefined) selection = deferredGroupSelection(deferredGroup, found, groups, chosen);
  const unassigned = found.filter((test) => !chosen.has(test));
  type Check = {
    readonly id: string;
    readonly line: string;
    readonly test?: string;
    readonly records?: boolean;
    readonly group?: number;
    readonly batch?: boolean;
    readonly afterTests?: true;
  };
  const first: Check[] = [
    ...policy.checks.filter((check) => check.after === undefined).map((check) => ({ id: check.id, line: check.command })),
    ...selection.selected.flatMap((test) => {
      const group = chosen.get(test);
      const command = group === undefined ? undefined : groups[group]?.command;
      return group === undefined || command === undefined
        ? []
        : [{ id: `test:${test}`, line: testLine(command, test, groups[group]?.contexts), test, records: command.includes("{dir}"), group, batch: command.includes("{tests}") }];
    }),
  ];
  const last: Check[] = policy.checks.filter((check) => check.after === "tests").map((check) => ({ id: check.id, line: check.command, afterTests: true }));
  if (!first.some((check) => check.records === true)) read = undefined;

  const runtime = toolchain.runtime(root);
  const kit = toolchain.kit(engineRoot, root);
  // A check whose command runs package scripts is kept under them besides.
  const scripts = toolchain.scripts(root);
  const invocation: Record<string, InvocationEvidence["tests"][string]> = {};
  const invocationDirectory = `${store}/scratch/invocation-${digest(`${root}\u0000${started}\u0000${processes.parallelism()}`)}`;
  const invocationPath = `${invocationDirectory}/evidence.json`;
  let invocationInput: string | undefined;
  const kindOf = (check: Check): string => verdictKind(check.id, check.line, check.afterTests === true
    ? digest(JSON.stringify(["after-tests/1", runtimeOf(check.line, runtime, scripts), invocationInput]))
    : runtimeOf(check.line, runtime, scripts));
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
        if (fresh || (check.afterTests === true && invocationInput === undefined)) return { check, reused: undefined };
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
  let invalidated = 0;
  let alone = 0;
  // The checks that passed, or were reused, and those that failed, which a check that needs them waits for.
  const passed = new Set<string>();
  const failedIds = new Set<string>();
  // How much runs at once, each group's own bound, and what each check needs first.
  const capacity = policy.capacity ?? processes.parallelism();
  const limits = new Map(groups.flatMap((group, index): [number, number][] => (group.capacity === undefined ? [] : [[index, group.capacity]])));
  const needsOf = new Map(policy.checks.map((check) => [check.id, check.needs ?? []]));
  let serial = 0;
  // A pass is kept only when `keep` holds; a check that reads what the tests kept is not kept on a pass whose
  // tests weren't all kept.
  const run = async (checks: readonly Check[], keep: boolean) => {
    const { planned, states } = plan(checks);
    for (const { check, reused: kept } of planned) {
      if (kept === undefined) continue;
      if (check.test !== undefined) invocation[check.test] = { command: check.line, verdict: kept };
      lines.push(`reused ${check.id}`);
      passed.add(check.id);
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
          const texts = new Map(files.filter((file) => file.type === "source" || file.type === "test")
            .map(({ path }) => [path, textFiles.read(`${root}/${path}`)]));
          textFiles.directory(invocationDirectory);
          textFiles.write(`${invocationDirectory}/functions.json`, JSON.stringify({ version: 1, functions, sourceHashes: Object.fromEntries([...texts].map(([file, text]) => [file, digest(text)])) }));
          return { files, functions, texts };
        })()
      : undefined;
    const fail = (check: Check, result: { readonly stdout: string; readonly stderr: string } | undefined): void => {
      lines.push(`failed ${check.id}`);
      failedIds.add(check.id);
      const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trimEnd().split("\n").slice(-40).join("\n");
      failures.set(check.id, `${check.id} failed:\n${output}\n`);
    };
    // A group whose command takes several tests `{tests}` runs a chunk's tests in one invocation, which takes half
    // the capacity; every other check, and each test a group runs alone, is a command of its own. A chunk is the
    // commands of up to 64 of a group's tests, whose passes are shared once they have all ended.
    type Chunk = { open: number };
    type Job = {
      readonly checks: readonly Check[];
      readonly batch: boolean;
      readonly weight: number;
      readonly group?: number;
      readonly needs: readonly string[];
      readonly chunk?: Chunk;
    };
    const wholeTree = due.filter((check) => check.test === undefined);
    const chunks = groups.map((_, index) => {
      const tests = due.filter((check) => check.test !== undefined && check.group === index);
      const lists: Job[][] = [];
      for (let from = 0; from < tests.length; from += CHUNK) {
        const slice = tests.slice(from, from + CHUNK);
        const batch = slice.some((check) => check.batch === true);
        const chunk = { open: batch ? 1 : slice.length };
        lists.push(
          batch
            ? [{ checks: slice, batch, weight: chunkWeight(capacity), group: index, needs: [], chunk }]
            : slice.map((check) => ({ checks: [check], batch, weight: 1, group: index, needs: [], chunk })),
        );
      }
      return lists;
    });
    // The groups' chunks in turn, so a group whose capacity holds it back leaves room to the others.
    const inTurn: Job[][] = [];
    for (let at = 0; chunks.some((lists) => at < lists.length); at++) for (const lists of chunks) if (lists[at] !== undefined) inTurn.push(lists[at] ?? []);
    const [opening, ...rest] = inTurn;
    const waiting: Job[] = [
      ...(opening ?? []),
      ...wholeTree.map((check) => ({ checks: [check], batch: false, weight: 1, needs: needsOf.get(check.id) ?? [] })),
      ...rest.flat(),
    ];
    // Each command runs, records into a scratch directory of its own and is settled once it ends; its passes are
    // kept and its scratch removed then, so a long gate holds the output of what runs and loses at most that if it
    // stops. A test of a batch whose reads can't be told apart runs again alone, once the batch has ended.
    const execute = async (job: Job): Promise<Check[]> => {
      const scratch = `${store}/scratch/${digest(`${root}\u0000${stopwatch.now()}\u0000${serial++}`)}`;
      const directory = `${scratch}/0`;
      textFiles.directory(`${directory}/runs`);
      // The command's start in the file system's own clock: a file changed after it changed while it ran. A
      // directory's time also moves for an entry made and removed again, as a test runner's bundled config is,
      // so a directory is judged by its listing alone.
      textFiles.write(`${scratch}/started`, "");
      const start = filesystem.modified(`${scratch}/started`) ?? 0;
      held.since(filesystem.version(`${scratch}/started`)?.changed ?? -Infinity);
      // An installed package is held by its lockfile entry, so it changed when the lockfile did.
      const changedSince = (key: string): boolean => {
        const { path: named, kind, package: installed } = heldPath(key);
        const path = installed === undefined ? named : "package-lock.json";
        const at = appPath(root, path);
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
        ownV8: readonly string[],
        supplemental: readonly ExecutionContext[],
      ): void => {
        lines.push(`passed ${check.id}`);
        passed.add(check.id);
        const ran = ranIn(lcov);
        for (const path of beside) ran.delete(path);
        const after = new Map(heldKeys(uses, ran).map((key) => [key, stateOf(key)]));
        // A path that changed while the check ran was read in one state and is kept in another, so the pass
        // describes neither: it is reported and not kept. That is a state other than the one a pass known before
        // the run kept, or, whether or not one was, a change since the command started.
        if ([...after].some(([path, state]) => (states.has(path) && states.get(path) !== state) || changedSince(path))) {
          invalidated++;
          unrecorded++;
          return;
        }
        const verdict: Verdict = { check: check.id, seconds, states: Object.fromEntries(after) };
        const report =
          check.test !== undefined && check.records === true && code !== undefined
            ? testRuns([{ test: check.test, lcov, v8: ownV8 }], code.files, root, loaded.config, code.functions, code.texts)[0]
            : undefined;
        const kept: Verdict = report === undefined ? verdict : { ...verdict, ran: report.ran, execution: executionContext(uses, ownV8, root, runtimeOf(check.line, runtime, scripts), supplemental) };
        if (check.test !== undefined) invocation[check.test] = { command: check.line, verdict: kept };
        if (!keep) {
          if (!fresh) unrecorded++;
          return;
        }
        if (fresh) return;
        evidenceStore.write(store, kindOf(check), heldKey(kept), JSON.stringify(kept));
        passes.push({ path: sharedPath(kindOf(check), heldKey(kept)), text: JSON.stringify(kept) });
        recorded++;
      };
      const coverage = `${directory}/runs`;
      const { checks, batch } = job;
      const [check] = checks;
      const tests = checks.flatMap((each) => (each.test === undefined ? [] : [each.test]));
      const command = check?.group === undefined ? undefined : groups[check.group]?.command;
      for (const test of tests) textFiles.directory(`${coverage}/${encodeURIComponent(test)}`);
      if (batch) textFiles.write(`${scratch}/0.tests`, tests.map((test) => `${test}\n`).join(""));
      // Raw V8 coverage also covers the processes a test starts, such as a launcher it runs.
      const [result] = await processes.shells(
        [
          {
            line:
              batch && command !== undefined
                ? command.replaceAll("{tests}", tests.join(" ")).replaceAll("{dir}", coverage).replaceAll("{provider}", coverageProvider.location)
                : check === undefined || check.test === undefined
                  ? (check?.line ?? "").replaceAll("{evidence}", invocationPath)
                  : check.line.replaceAll("{dir}", coverage),
            env: {
              // Added to the options the caller gives Node, such as its certificates, rather than put in their place.
              NODE_OPTIONS: [processes.environment("NODE_OPTIONS"), `--import ${readRecorder.location}`].filter((option) => option !== undefined && option !== "").join(" "),
              KIT_READS: directory,
              KIT_ROOT: root,
              // The Kit running the gate: its files are recorded as the app's when it is installed among the
              // app's packages, and its loaded code is marked when it is outside the app.
              KIT_ENGINE: engineRoot,
              KIT_TESTS: batch ? `${scratch}/0.tests` : "",
              KIT_TEST: batch ? "" : check?.test ?? "",
              KIT_COVERAGE: coverage,
              KIT_FUNCTIONS: `${invocationDirectory}/functions.json`,
              KIT_RUNTIME: check === undefined ? "" : runtimeOf(check.line, runtime, scripts),
              KIT_CONTEXTS: check?.group === undefined ? "" : [...(groups[check.group]?.contexts ?? [])].sort().join(","),
              ...(check?.records === true ? { NODE_V8_COVERAGE: `${coverage}/v8` } : {}),
            },
          },
        ],
        root,
      );
      const seconds = (stopwatch.now() - started) / 1000;
      const supplementalContexts = (directory: string, check: Check): ExecutionContext[] => {
        const required = check.group === undefined ? [] : groups[check.group]?.contexts ?? [];
        const names = new Set([...required, ...namedIn(directory).flatMap(({ name }) => /^([a-z][a-z0-9-]*)-context\.json$/.exec(name)?.[1] ?? [])]);
        return [...names].map((name) => {
          try {
            const context = executionContextOf(JSON.parse(textFiles.read(`${directory}/${name}-context.json`)));
            if (context !== undefined) return context;
          } catch {
            // Missing required or malformed capture must not turn browser execution into Node-only proof.
          }
          return { complete: false, loaded: [], runtime };
        });
      };
      const again: Check[] = [];
      if (!batch) {
        if (check !== undefined) {
          if (result?.status !== 0) fail(check, result);
          else {
            const lcov = check.records === true ? filesIn(coverage) : [];
            const recordings = namedIn(directory);
            const v8 = check.records === true ? namedIn(`${coverage}/v8`) : [];
            const beside = check.test === undefined ? new Set<string>() : loadedBeside(recordings, v8, check.test, root);
            settle(check, seconds, pathUses(recordings.map((each) => each.text)), beside, lcov, v8.map((each) => each.text), supplementalContexts(`${coverage}/${encodeURIComponent(check.test ?? "")}`, check));
          }
        }
      } else {
        const own = (test: string, file: string): string | undefined => {
          const path = `${coverage}/${encodeURIComponent(test)}/${file}`;
          return textFiles.exists(path) ? textFiles.read(path) : undefined;
        };
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
        // The worker and its children supply a test's execution credit. Shared runner coverage describes
        // no individual proof; the runner's observed inputs remain in the outcome's uses for cache validity.
        for (const outcome of outcomes) {
          const each = checks.find((item) => item.test === outcome.test);
          if (each === undefined) continue;
          if (outcome.outcome === "passed") {
            const lcov = filesIn(`${coverage}/${encodeURIComponent(outcome.test)}`);
            const children = namedIn(`${coverage}/v8/${encodeURIComponent(outcome.test)}`);
            const beside = loadedBeside([], children, outcome.test, root);
            const ownRun = own(outcome.test, "execution.json");
            settle(each, seconds, outcome.uses, beside, lcov, [...children.map((child) => child.text), ...(ownRun === undefined ? [] : [ownRun])], supplementalContexts(`${coverage}/${encodeURIComponent(outcome.test)}`, each));
          } else if (outcome.outcome === "failed") fail(each, result);
          else again.push(each);
        }
      }
      textFiles.remove(scratch);
      return again;
    };
    // Commands start as the schedule lets them and each, once it ends, makes room for the next; a test run again
    // alone waits before every other, so its chunk ends soon. A check one of whose needs failed fails unrun.
    let used = 0;
    const running = new Map<number, number>();
    await new Promise<void>((resolve, reject) => {
      let active = 0;
      const pump = (): void => {
        for (;;) {
          const { start, blocked } = schedule(waiting, { capacity, used, running, groups: limits, passed, failed: failedIds });
          for (const job of blocked) {
            waiting.splice(waiting.indexOf(job), 1);
            const unmet = job.needs.filter((need) => failedIds.has(need));
            for (const check of job.checks) fail(check, { stdout: "", stderr: `not run: it needs ${unmet.join(", ")}, which failed.` });
          }
          if (blocked.length > 0) continue;
          for (const job of start) {
            waiting.splice(waiting.indexOf(job), 1);
            used += job.weight;
            if (job.group !== undefined) running.set(job.group, (running.get(job.group) ?? 0) + 1);
            active++;
            execute(job).then((again) => {
              used -= job.weight;
              if (job.group !== undefined) running.set(job.group, (running.get(job.group) ?? 1) - 1);
              active--;
              alone += again.length;
              const chunk = job.chunk;
              waiting.unshift(...again.map((check) => ({ checks: [check], batch: true, weight: 1, needs: [], ...(job.group === undefined ? {} : { group: job.group }), ...(chunk === undefined ? {} : { chunk }) })));
              if (chunk !== undefined) {
                chunk.open += again.length - 1;
                if (chunk.open === 0) publish();
              }
              pump();
            }, reject);
          }
          break;
        }
        if (active > 0) return;
        // Nothing runs and nothing can start: every command has run.
        for (const job of waiting.splice(0)) for (const check of job.checks) fail(check, { stdout: "", stderr: "not run: its needs never passed." });
        resolve();
      };
      pump();
    });
  };

  // With more than one group, a test's line names the group it runs in; a test no group takes is named, not run.
  const named = (check: Check): string => (check.group !== undefined && groups.length > 1 ? `${check.id} in tests[${check.group}]` : check.id);
  const left = unassigned.map((test) => `unassigned test:${test}`);
  if (args.includes("--plan")) {
    const opening = plan(first).planned;
    for (const { check, reused } of opening)
      if (check.test !== undefined && reused !== undefined) invocation[check.test] = { command: check.line, verdict: reused };
    if (opening.every(({ check, reused }) => check.test === undefined || reused !== undefined))
      invocationInput = invocationIdentity({ version: 1, root, runtime, scripts, tests: invocation });
    const planned = [...opening, ...plan(last).planned];
    return {
      stdout: [...planned.map(({ check, reused: kept }) => `${kept === undefined ? "run" : "reuse"} ${named(check)}`), ...left].map((line) => `${line}\n`).join(""),
      stderr: "",
      exitCode: unassigned.length > 0 ? 1 : 0,
    };
  }
  await run(first, true);
  // A check declared after the tests, such as one reading what each test ran, runs once their passes are kept.
  textFiles.directory(invocationDirectory);
  const evidence: InvocationEvidence = { version: 1, root, runtime, scripts, tests: invocation };
  invocationInput = invocationIdentity(evidence);
  textFiles.write(invocationPath, invocationText(evidence));
  try {
    await run(last, failures.size === 0 && unrecorded === 0);
  } finally {
    textFiles.remove(invocationDirectory);
  }
  // What reuse alone kept, with no chunk run after it, is added now.
  publish();
  evidenceStore.prune(store);
  const failed = lines.filter((line) => line.startsWith("failed ")).length;
  const notes = [
    ...(shared !== undefined && "failure" in shared ? [`Shared no passes: ${shared.failure}\n`] : []),
    ...(unpublished === undefined ? [] : [`Published no ${published > 0 ? "more " : ""}passes: ${unpublished}\n`]),
  ];
  const summary = {
    scope: selection.scope,
    ...(deferredGroup === undefined ? {} : { selectionKind: "deferred-groups", deferredGroups: [deferredGroup] }),
    discovery: selection.discovery,
    policy: selection.policy,
    discovered: found.length,
    selected: selection.selected,
    deferred: selection.deferred,
    reused,
    ran,
    failed,
    recorded,
    unrecorded,
    invalidated,
    alone,
    unassigned: unassigned.length,
    shared: { read: shared?.read ?? 0, published },
    states: { ...held.receipt },
    seconds: (stopwatch.now() - started) / 1000,
  };
  return {
    stdout: `${[...lines, ...left].sort().join("\n")}\n${notes.join("")}${selection.scope === "all" ? "" : "Kit verify null\n"}${selection.scope === "all" ? "Kit verify" : "Kit selection"} ${JSON.stringify(summary)}\n`,
    stderr: [...failures.values(), ...unassigned.map((test) => `${test}: no test group takes it, so it never runs.\n`)].join(""),
    exitCode: failed > 0 || unassigned.length > 0 || invalidated > 0 ? 1 : 0,
  };
}
