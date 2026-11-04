import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface ProofRunner {
  readonly location: string;
  run(args: readonly string[], cwd: string): Promise<number>;
}

// The runner takes an explicit empty workspace instead of discovering application projects.
const workspace: readonly [] = [];
export default workspace;

export const proofRunner: ProofRunner = {
  location: fileURLToPath(new URL("../../../scripts/kit-proof.mjs", import.meta.url)),
  async run(args, cwd) {
    const { parseCLI, startVitest } = await import("vitest/node");
    const { filter, options } = parseCLI(["vitest", ...args]);
    if (options.config !== undefined || options.workspace !== undefined || options.watch || options.ui || options.browser)
      throw new Error("The bounded proof runner accepts no application config, workspace, watch, browser or UI. Use the application's declared runner for those journeys.");
    if (options.exclude !== undefined) {
      options.cliExclude = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
      delete options.exclude;
    }
    const overrides: import("vite").InlineConfig = { configFile: false, envFile: false, css: { postcss: { plugins: [] } } };
    const context = await startVitest("test", filter, {
      ...options,
      root: resolve(cwd, options.root ?? "."),
      config: false,
      workspace: fileURLToPath(import.meta.url),
      run: true,
      watch: false,
    }, overrides);
    try {
      const status = Number(process.exitCode ?? 0);
      return context === undefined && status === 0 ? 1 : status;
    } finally {
      await context?.close();
    }
  },
};
