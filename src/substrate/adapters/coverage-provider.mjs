import fs from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// A coverage provider for vitest 1.x, named to it as a custom provider module, that runs the installed
// `@vitest/coverage-v8` and writes what each test file ran on its own: under the reports directory, `batch.json`
// with the run's unhandled errors, and a directory per test file, named by its path inside the app, holding its
// LCOV report and `run.json`, the test's result and every script it executed. A test file's coverage is told
// apart by the one test of the run among the scripts it executed; one whose coverage names none or several is
// written without scripts. Importing it to find its path changes nothing.

// The installed provider, which an app installs beside the Kit it runs.
const installed = async () => (await import("@vitest/coverage-v8")).default;

// What the runner asks of the provider in each test's process, done by the installed provider.
/** @param {"startCoverage" | "takeCoverage" | "stopCoverage"} name */
const forwarded = (name) => async () => (await installed())[name]?.();

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// The files a coverage blob's scripts were loaded from, without a query.
/** @param {unknown} coverage */
const scriptsOf = (coverage) => {
  const results = isRecord(coverage) && Array.isArray(coverage["result"]) ? coverage["result"] : [];
  /** @type {string[]} */
  const files = [];
  for (const result of results) {
    const url = isRecord(result) ? result["url"] : undefined;
    if (typeof url === "string" && url.startsWith("file://")) files.push(fileURLToPath(url.replace(/[?#].*$/, "")));
  }
  return [...new Set(files)].sort();
};

/**
 * @typedef {{
 *   readonly location: string,
 *   getProvider(): Promise<{
 *     initialize(context: unknown): void,
 *     onAfterSuiteRun(meta: unknown): void,
 *     reportCoverage(options?: unknown): Promise<void>,
 *   }>,
 * }} CoverageProvider
 */
/** @type {CoverageProvider} */
export const coverageProvider = {
  location: fileURLToPath(import.meta.url),
  // The installed provider, which keeps each file's coverage apart and reports each on its own. Only what the
  // runner calls is shown.
  async getProvider() {
    const provider = await (await installed()).getProvider();
    const keep = provider.onAfterSuiteRun.bind(provider);
    const report = provider.reportCoverage.bind(provider);
    /** @typedef {Parameters<typeof keep>[0]} Meta */
    // The run's test files, each with its result.
    const files = () => provider.ctx.state.getFiles().map((task) => ({ file: task.filepath, state: task.result?.state }));
    /** @type {Map<string, Meta[]>} */
    const runs = new Map();
    /** @param {Meta} meta */
    provider.onAfterSuiteRun = (meta) => {
      const tests = new Set(files().map(({ file }) => file));
      const own = scriptsOf(meta.coverage).filter((file) => tests.has(file));
      const test = own.length === 1 ? own[0] : undefined;
      if (test !== undefined) runs.set(test, [...(runs.get(test) ?? []), meta]);
    };
    /** @param {Parameters<typeof report>[0]} options */
    provider.reportCoverage = async (options) => {
      const root = provider.ctx.config.root;
      const all = provider.options;
      const reports = all.reportsDirectory;
      fs.mkdirSync(reports, { recursive: true });
      fs.writeFileSync(join(reports, "batch.json"), JSON.stringify({ errors: provider.ctx.state.getUnhandledErrors().length }));
      for (const { file, state } of files()) {
        const test = relative(root, file);
        const directory = join(reports, encodeURIComponent(test));
        fs.mkdirSync(directory, { recursive: true });
        const [meta, ...more] = runs.get(file) ?? [];
        const single = more.length === 0 ? meta : undefined;
        fs.writeFileSync(join(directory, "run.json"), JSON.stringify({ test, state: state ?? null, scripts: single === undefined ? null : scriptsOf(single.coverage) }));
        if (single === undefined) continue;
        // The installed provider reports the coverage it was given since it last reported, into its reports
        // directory, so each file's is given alone with the file's own directory.
        provider.coverageFiles = new Map();
        provider.pendingPromises = [];
        fs.mkdirSync(provider.coverageFilesDirectory, { recursive: true });
        provider.options = { ...all, reportsDirectory: directory };
        keep(single);
        await report(options);
      }
      provider.options = all;
    };
    return provider;
  },
};

// The module vitest loads by path: each test's process forwards to the installed provider, and the run's main
// process reports through this one.
export default {
  startCoverage: forwarded("startCoverage"),
  takeCoverage: forwarded("takeCoverage"),
  stopCoverage: forwarded("stopCoverage"),
  getProvider: coverageProvider.getProvider,
};
