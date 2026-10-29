import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { Verdict } from "../../core/primitives/verdict.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { digest } from "../../core/readings/fact-keys.js";
import { testRuns } from "../../core/readings/test-runs.js";
import { ranLines } from "../../core/readings/coverage-report.js";
import { functionsRun } from "../../core/readings/ran-code.js";
import { sharedPath, sharedRefs } from "../../core/readings/shared-passes.js";
import { heldKey, heldKeys, holding, pathUses, verdictKind, verdictOf } from "../../core/readings/verdict-reuse.js";
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

// `kit verify`: run every check the config's `verify` declares, and every test under its tests directories,
// except those whose last passing run read only paths that are still in the state that run saw. Each run is
// watched for what it reads, in its processes and theirs, and a pass is kept with those states; a failure is
// never kept. A test command that writes the test's coverage into `{dir}` keeps what the test ran with its pass.
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
      const path = `${directory}/${entry.name}`;
      if (entry.directory && !SKIP.test(entry.name)) walk(path);
      else if (entry.file && TEST.test(entry.name)) tests.push(path);
    }
  };
  for (const directory of policy.tests?.under ?? []) walk(directory);
  const testCommand = policy.tests?.command ?? "";
  const records = testCommand.includes("{dir}");
  type Check = { readonly id: string; readonly line: string; readonly test?: string };
  const first: Check[] = [
    ...policy.checks.filter((check) => check.after === undefined).map((check) => ({ id: check.id, line: check.command })),
    ...tests.sort().map((test) => ({ id: `test:${test}`, line: testCommand.replaceAll("{test}", test), test })),
  ];
  const last: Check[] = policy.checks.filter((check) => check.after === "tests").map((check) => ({ id: check.id, line: check.command }));

  const store = evidenceStore.directory(root);
  const runtime = toolchain.runtime(root);
  const kindOf = (check: Check): string => verdictKind(check.id, check.line, runtime);
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
    const filesIn = (directory: string): string[] =>
      textFiles.exists(directory)
        ? textFiles
            .entries(directory)
            .filter((entry) => entry.file)
            .map((entry) => textFiles.read(`${directory}/${entry.name}`))
        : [];
    // What each test ran is read against the code it ran, by the named functions extraction finds in it: read
    // once, before the tests, and kept as only what that needs.
    const code =
      records && due.some((check) => check.test !== undefined)
        ? (() => {
            const { snapshot } = readStoredSnapshot(root, loaded.config, {
              reuse: evidenceStore.at(store),
              engine: toolchain.engine(engineRoot),
            });
            const functions = (snapshot.compiler?.projects ?? []).flatMap((project) => project.functions ?? []);
            const texts = new Map([...new Set(functions.map((fn) => fn.file))].map((file) => [file, textFiles.read(`${root}/${file}`)]));
            return { files: snapshot.files, functions, texts };
          })()
        : undefined;
    // The checks run a chunk at a time, and each chunk's passes are kept and its scratch removed before the next,
    // so a long gate holds one chunk's output and loses at most one chunk if it stops.
    for (let from = 0; from < due.length; from += CHUNK) {
      const chunk = due.slice(from, from + CHUNK);
      const scratch = `${store}/scratch/${digest(`${root}\u0000${stopwatch.now()}\u0000${from}`)}`;
      const directories = chunk.map((_, index) => `${scratch}/${index}`);
      for (const directory of directories) textFiles.directory(`${directory}/runs`);
      // Raw V8 coverage also covers the processes a test starts, such as a launcher it runs.
      const results = await processes.shells(
        chunk.map((check, index) => {
          const directory = directories[index] ?? scratch;
          const coverage = `${directory}/runs`;
          return {
            line: check.test === undefined ? check.line : check.line.replaceAll("{dir}", coverage),
            env: {
              NODE_OPTIONS: `--import ${readRecorder.location}`,
              KIT_READS: directory,
              KIT_ROOT: root,
              ...(check.test !== undefined && records ? { NODE_V8_COVERAGE: `${coverage}/v8` } : {}),
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
        const lcov = check.test !== undefined && records ? filesIn(`${directory}/runs`) : [];
        const after = new Map(heldKeys(pathUses(filesIn(directory)), ranIn(lcov)).map((key) => [key, stateOf(key)]));
        // A path that changed while the check ran was read in one state and is kept in another, so the pass
        // describes neither: it is reported and not kept.
        if (!keep || [...after].some(([path, state]) => states.has(path) && states.get(path) !== state)) {
          unrecorded++;
          return;
        }
        const verdict: Verdict = { check: check.id, seconds, states: Object.fromEntries(after) };
        const report =
          check.test !== undefined && code !== undefined
            ? testRuns([{ test: check.test, lcov, v8: filesIn(`${directory}/runs/v8`) }], code.files, root, loaded.config, code.functions, code.texts)[0]
            : undefined;
        const kept: Verdict = report === undefined ? verdict : { ...verdict, ran: report.ran };
        evidenceStore.write(store, kindOf(check), heldKey(kept), JSON.stringify(kept));
        passes.push({ path: sharedPath(kindOf(check), heldKey(kept)), text: JSON.stringify(kept) });
        recorded++;
      });
      textFiles.remove(scratch);
    }
  };

  if (args.includes("--plan")) {
    const planned = [...plan(first).planned, ...plan(last).planned];
    return {
      stdout: planned.map(({ check, reused: kept }) => `${kept === undefined ? "run" : "reuse"} ${check.id}\n`).join(""),
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
    shared: { read: shared?.read ?? 0, published: published?.published ?? 0 },
    seconds: (stopwatch.now() - started) / 1000,
  };
  return {
    stdout: `${lines.sort().join("\n")}\n${notes.join("")}Kit verify ${JSON.stringify(summary)}\n`,
    stderr: [...failures.values()].join(""),
    exitCode: failed > 0 ? 1 : 0,
  };
}
