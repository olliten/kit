import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { Verdict } from "../../core/primitives/verdict.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { digest } from "../../core/readings/fact-keys.js";
import { testRuns } from "../../core/readings/test-runs.js";
import { heldKey, holding, readPaths, verdictKind, verdictOf } from "../../core/readings/verdict-reuse.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { filesystem } from "../adapters/filesystem.js";
import { processes } from "../adapters/processes.js";
import { readRecorder } from "../adapters/read-recorder.mjs";
import { stopwatch } from "../adapters/stopwatch.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { readConfig } from "./read-config.js";
import { readStoredSnapshot } from "./read-snapshot.js";

const TEST = /\.test\.[mc]?[jt]sx?$/;
const SKIP = /^(?:node_modules|\..*)$/;

// `kit verify`: run every check the config's `verify` declares, and every test under its tests directories,
// except those whose last passing run read only paths that are still in the state that run saw. Each run is
// watched for what it reads, in its processes and theirs, and a pass is kept with those states; a failure is
// never kept. A test command that writes the test's coverage into `{dir}` keeps what the test ran with its pass.
// `--fresh` reuses and keeps nothing, and `--plan` says what would run without running it.
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
            if (!states.has(path)) states.set(path, filesystem.state(`${root}/${path}`));
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
    for (const { check, reused: kept } of planned) if (kept !== undefined) lines.push(`reused ${check.id}`);
    reused += planned.filter((item) => item.reused !== undefined).length;
    const due = planned.filter((item) => item.reused === undefined).map((item) => item.check);
    ran += due.length;
    const scratch = `${store}/scratch/${digest(`${root}\u0000${stopwatch.now()}`)}`;
    const directories = due.map((_, index) => `${scratch}/${index}`);
    for (const directory of directories) textFiles.directory(`${directory}/runs`);
    // Raw V8 coverage also covers the processes a test starts, such as a launcher it runs.
    const results = await processes.shells(
      due.map((check, index) => {
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
    const passes: { readonly check: Check; readonly verdict: Verdict }[] = [];
    const reports: { readonly test: string; readonly lcov: string[]; readonly v8: string[] }[] = [];
    const filesIn = (directory: string): string[] =>
      textFiles.exists(directory)
        ? textFiles
            .entries(directory)
            .filter((entry) => entry.file)
            .map((entry) => textFiles.read(`${directory}/${entry.name}`))
        : [];
    due.forEach((check, index) => {
      const result = results[index];
      const directory = directories[index] ?? scratch;
      if (result?.status !== 0) {
        lines.push(`failed ${check.id}`);
        const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trimEnd().split("\n").slice(-40).join("\n");
        failures.set(check.id, `${check.id} failed:\n${output}\n`);
        return;
      }
      lines.push(`passed ${check.id}`);
      const after = new Map(readPaths(filesIn(directory)).map((path) => [path, filesystem.state(`${root}/${path}`)]));
      // A path that changed while the check ran was read in one state and is kept in another, so the pass
      // describes neither: it is reported and not kept.
      if (!keep || [...after].some(([path, state]) => states.has(path) && states.get(path) !== state)) {
        unrecorded++;
        return;
      }
      passes.push({ check, verdict: { check: check.id, seconds, states: Object.fromEntries(after) } });
      if (check.test !== undefined && records)
        reports.push({ test: check.test, lcov: filesIn(`${directory}/runs`), v8: filesIn(`${directory}/runs/v8`) });
    });
    // What each test ran is read against the code it ran, by the named functions extraction finds in it.
    const ranBy = new Map<string, Readonly<Record<string, readonly string[]>>>();
    if (reports.length > 0) {
      const { snapshot } = readStoredSnapshot(root, loaded.config, {
        reuse: evidenceStore.at(store),
        engine: toolchain.engine(engineRoot),
      });
      const functions = (snapshot.compiler?.projects ?? []).flatMap((project) => project.functions ?? []);
      const texts = new Map([...new Set(functions.map((fn) => fn.file))].map((file) => [file, textFiles.read(`${root}/${file}`)]));
      for (const { test, ran: modules } of testRuns(reports, snapshot.files, root, loaded.config, functions, texts)) ranBy.set(test, modules);
    }
    for (const { check, verdict } of passes) {
      const modules = check.test === undefined ? undefined : ranBy.get(check.test);
      const kept: Verdict = modules === undefined ? verdict : { ...verdict, ran: modules };
      evidenceStore.write(store, kindOf(check), heldKey(kept), JSON.stringify(kept));
      recorded++;
    }
    textFiles.remove(scratch);
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
  evidenceStore.prune(store);
  const failed = lines.filter((line) => line.startsWith("failed ")).length;
  const summary = { reused, ran, failed, recorded, unrecorded, seconds: (stopwatch.now() - started) / 1000 };
  return {
    stdout: `${lines.sort().join("\n")}\nKit verify ${JSON.stringify(summary)}\n`,
    stderr: [...failures.values()].join(""),
    exitCode: failed > 0 ? 1 : 0,
  };
}
