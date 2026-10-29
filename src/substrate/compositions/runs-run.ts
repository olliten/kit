import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { testRuns } from "../../core/readings/test-runs.js";
import { processes } from "../adapters/processes.js";
import { textFiles } from "../adapters/text-files.js";
import { readConfig } from "./read-config.js";
import { readSnapshot } from "./read-snapshot.js";

// `kit runs`: run each test file alone with the app's own command, which writes an LCOV report into its own
// directory, and record which named functions of each placed module each test ran. A failing test still
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
  const snapshot = readSnapshot(root, config);
  const tests = snapshot.files
    .filter((file) => file.type === "test" && file.path.startsWith(`${config.oracleRoot}/`))
    .map((file) => file.path);
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
  const read = (dir: string): string[] =>
    textFiles.exists(dir)
      ? textFiles
          .entries(dir)
          .filter((entry) => entry.file)
          .map((entry) => textFiles.read(`${dir}/${entry.name}`))
      : [];
  const reports = tests.map((test, index) => {
    const dir = dirs[index] ?? scratch;
    return { test, lcov: read(dir), v8: read(`${dir}/v8`) };
  });
  textFiles.remove(scratch);
  const functions = (snapshot.compiler?.projects ?? []).flatMap((project) => project.functions ?? []);
  const texts = new Map([...new Set(functions.map((fn) => fn.file))].map((file) => [file, textFiles.read(`${root}/${file}`)]));
  const runs = testRuns(reports, snapshot.files, root, config, functions, texts);
  textFiles.write(`${root}/${config.runs.record}`, JSON.stringify(runs, null, 2) + "\n");
  const failed = tests.filter((_, index) => results[index]?.status !== 0);
  const unreported = reports.filter((report) => report.lcov.length === 0).map((report) => report.test);
  return {
    stdout: `Kit runs recorded ${tests.length} tests in ${config.runs.record}.\n`,
    stderr: [
      ...failed.map((test) => `${test}: the test command failed; what it ran is recorded.`),
      ...unreported.map((test) => `${test}: the test command wrote no LCOV report into {dir}.`),
    ].map((line) => `${line}\n`).join(""),
    exitCode: unreported.length > 0 ? 1 : 0,
  };
}
