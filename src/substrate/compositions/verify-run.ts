import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { Verdict } from "../../core/primitives/verdict.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { digest } from "../../core/readings/fact-keys.js";
import { holdingVerdict, readPaths, verdictKey, verdictOf } from "../../core/readings/verdict-reuse.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { filesystem } from "../adapters/filesystem.js";
import { processes } from "../adapters/processes.js";
import { readRecorder } from "../adapters/read-recorder.mjs";
import { stopwatch } from "../adapters/stopwatch.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { readConfig } from "./read-config.js";

const TEST = /\.test\.[mc]?[jt]sx?$/;
const SKIP = /^(?:node_modules|\..*)$/;

// `kit verify`: run every check the config's `verify` declares, and every test under its tests directory,
// except those whose last passing run read only paths that are still in the state that run saw. Each run is
// watched for what it reads, in its processes and theirs, and a pass is kept with those states; a failure is
// never kept. `--fresh` reuses and keeps nothing, and `--plan` says what would run without running it.
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
  if (policy.tests !== undefined) walk(policy.tests.under);
  const testCommand = policy.tests?.command ?? "";
  const checks = [
    ...policy.checks.map((check) => ({ id: check.id, line: check.command })),
    ...tests.sort().map((test) => ({ id: `test:${test}`, line: testCommand.replaceAll("{test}", test) })),
  ];

  const store = evidenceStore.directory(root);
  const runtime = toolchain.runtime(root);
  const kindOf = (check: { readonly id: string; readonly line: string }): string =>
    `verdicts/${digest(JSON.stringify([check.id, check.line, runtime]))}`;
  const states = new Map<string, string>();
  const stateOf = (path: string): string => {
    const known = states.get(path);
    if (known !== undefined) return known;
    const found = filesystem.state(`${root}/${path}`);
    states.set(path, found);
    return found;
  };
  const planned = checks.map((check) => {
    if (fresh) return { check, reused: undefined };
    const verdicts = evidenceStore
      .entries(store, kindOf(check))
      .map(verdictOf)
      .flatMap((verdict) => (verdict === null ? [] : [verdict]));
    for (const verdict of verdicts) for (const path of Object.keys(verdict.states)) stateOf(path);
    return { check, reused: holdingVerdict(verdicts, states) };
  });
  if (args.includes("--plan"))
    return {
      stdout: planned.map(({ check, reused }) => `${reused === undefined ? "run" : "reuse"} ${check.id}\n`).join(""),
      stderr: "",
      exitCode: 0,
    };

  const due = planned.filter((item) => item.reused === undefined).map((item) => item.check);
  const scratch = `${store}/scratch/${digest(`${root}\u0000${stopwatch.now()}`)}`;
  const directories = due.map((_, index) => `${scratch}/${index}`);
  for (const directory of directories) textFiles.directory(directory);
  const results = await processes.shells(
    due.map((check, index) => ({
      line: check.line,
      env: { NODE_OPTIONS: `--import ${readRecorder.location}`, KIT_READS: directories[index] ?? scratch, KIT_ROOT: root },
    })),
    root,
  );
  const seconds = (stopwatch.now() - started) / 1000;
  let recorded = 0;
  let unrecorded = 0;
  const lines: string[] = [];
  let stderr = "";
  due.forEach((check, index) => {
    const result = results[index];
    const directory = directories[index] ?? scratch;
    if (result?.status !== 0) {
      lines.push(`failed ${check.id}`);
      const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trimEnd().split("\n").slice(-40).join("\n");
      stderr += `${check.id} failed:\n${output}\n`;
      return;
    }
    lines.push(`passed ${check.id}`);
    const recordings = textFiles.exists(directory)
      ? textFiles
          .entries(directory)
          .filter((entry) => entry.file)
          .map((entry) => textFiles.read(`${directory}/${entry.name}`))
      : [];
    const before = new Map(states);
    const after = new Map(readPaths(recordings).map((path) => [path, filesystem.state(`${root}/${path}`)]));
    // A path that changed while the check ran was read in one state and is kept in another, so the pass describes
    // neither: it is reported and not kept.
    if ([...after].some(([path, state]) => before.has(path) && before.get(path) !== state)) {
      unrecorded++;
      return;
    }
    const verdict: Verdict = { check: check.id, seconds, states: Object.fromEntries(after) };
    evidenceStore.write(store, kindOf(check), verdictKey(verdict), JSON.stringify(verdict));
    recorded++;
  });
  textFiles.remove(scratch);
  evidenceStore.prune(store);
  for (const { check, reused } of planned) if (reused !== undefined) lines.push(`reused ${check.id}`);
  const failed = lines.filter((line) => line.startsWith("failed ")).length;
  const summary = { reused: planned.length - due.length, ran: due.length, failed, recorded, unrecorded, seconds };
  return {
    stdout: `${lines.sort().join("\n")}\nKit verify ${JSON.stringify(summary)}\n`,
    stderr,
    exitCode: failed > 0 ? 1 : 0,
  };
}
