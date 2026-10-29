import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { KitConfig } from "../../core/primitives/default-config.js";
import type { Snapshot } from "../../core/primitives/snapshot.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { recordInputs, recordPathOf, runsFreshness } from "../../core/readings/runs-freshness.js";
import { testRuns } from "../../core/readings/test-runs.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { processes } from "../adapters/processes.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { readConfig } from "./read-config.js";
import { readStoredSnapshot } from "./read-snapshot.js";

// `kit runs`: run each test file alone with the app's own command, which writes an LCOV report into its own
// directory, and record per test which named functions of each placed module it ran. Given test paths it records
// only those; with `--stale` only the tests whose records no longer describe the code; with neither, every test.
// Recording every test or the stale ones removes the records of tests that are gone. A failing test still
// records what it ran; the failure is reported, since the test suite is where it is fixed.
export async function runRuns({ engineRoot, args, cwd }: CommandRequest): Promise<CommandResponse> {
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
  const { config } = loaded;
  if (config.runs === undefined)
    return { stdout: "", stderr: `Kit config ${configPath}: declare runs, its record path and test command.\n`, exitCode: 1 };
  const store = evidenceStore.directory(root);
  const { snapshot } = readStoredSnapshot(root, config, {
    reuse: {
      read: (kind, key) => evidenceStore.read(store, kind, key),
      write: (kind, key, text) => evidenceStore.write(store, kind, key, text),
      entries: (kind) => evidenceStore.entries(store, kind),
    },
    engine: toolchain.engine(engineRoot),
  });
  const { records, orphans } = runsFreshness(snapshot);
  const stale = args.includes("--stale");
  const named = args.filter((argument, index) => !argument.startsWith("--") && !["--root", "--config"].includes(args[index - 1] ?? ""));
  const known = new Set(records.map((state) => state.test));
  const chosen = named.map((path) => {
    const absolute = at(path);
    return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
  });
  const unknown = chosen.filter((test) => !known.has(test));
  if (unknown.length > 0)
    return { stdout: "", stderr: unknown.map((test) => `${test} is not a test under ${config.oracleRoot}/.\n`).join(""), exitCode: 1 };
  const tests =
    chosen.length > 0
      ? chosen
      : records.filter((state) => !stale || state.status !== "fresh").map((state) => state.test);
  const scratch = `${root}/.kit-runs`;
  textFiles.remove(scratch);
  const dirs = tests.map((_, index) => `${scratch}/${index}`);
  for (const dir of dirs) textFiles.directory(dir);
  const { each } = config.runs;
  // Raw V8 coverage also covers the processes a test starts, such as a launcher it runs.
  const results = await processes.shells(
    tests.map((test, index) => {
      const dir = dirs[index] ?? scratch;
      return { line: each.replaceAll("{test}", test).replaceAll("{dir}", dir), env: { NODE_V8_COVERAGE: `${dir}/v8` } };
    }),
    root,
  );
  const reports = tests.map((test, index) => reportsIn(test, dirs[index] ?? scratch));
  textFiles.remove(scratch);
  writeRuns(root, config, snapshot, reports);
  const removed = chosen.length > 0 ? [] : orphans;
  for (const path of removed) textFiles.remove(`${root}/${path}`);
  const failed = tests.filter((_, index) => results[index]?.status !== 0);
  const unreported = reports.filter((report) => report.lcov.length === 0).map((report) => report.test);
  return {
    stdout: `Kit runs recorded ${tests.length} tests in ${config.runs.record}/, removed ${removed.length} records of gone tests.\n`,
    stderr: [
      ...failed.map((test) => `${test}: the test command failed; what it ran is recorded.`),
      ...unreported.map((test) => `${test}: the test command wrote no LCOV report into {dir}.`),
    ].map((line) => `${line}\n`).join(""),
    exitCode: unreported.length > 0 ? 1 : 0,
  };
}

// One test's coverage reports from the directory its command wrote them into: LCOV files in it, raw V8
// coverage in its `v8` directory.
export function reportsIn(test: string, directory: string): { readonly test: string; readonly lcov: string[]; readonly v8: string[] } {
  const read = (dir: string): string[] =>
    textFiles.exists(dir)
      ? textFiles
          .entries(dir)
          .filter((entry) => entry.file)
          .map((entry) => textFiles.read(`${dir}/${entry.name}`))
      : [];
  return { test, lcov: read(directory), v8: read(`${directory}/v8`) };
}

// Writes each reported test's runs record, from its reports and the snapshot the tests ran over.
export function writeRuns(
  root: string,
  config: KitConfig,
  snapshot: Snapshot,
  reports: readonly { readonly test: string; readonly lcov: readonly string[]; readonly v8: readonly string[] }[],
): void {
  const record = config.runs?.record;
  if (record === undefined || reports.length === 0) return;
  const functions = (snapshot.compiler?.projects ?? []).flatMap((project) => project.functions ?? []);
  const texts = new Map([...new Set(functions.map((fn) => fn.file))].map((file) => [file, textFiles.read(`${root}/${file}`)]));
  const inputs = recordInputs(snapshot);
  const written = testRuns(reports, snapshot.files, root, config, new Map(reports.map(({ test }) => [test, inputs(test)])), functions, texts);
  textFiles.directory(`${root}/${record}`);
  for (const each of written) textFiles.write(`${root}/${recordPathOf(record, each.test)}`, JSON.stringify(each, null, 2) + "\n");
}
