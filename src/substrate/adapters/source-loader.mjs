import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {(name: string) => Promise<Record<string, unknown>>} Load */
/** @typedef {{ isMain(moduleUrl: string, entry?: string): boolean; load(engineRoot: string, modules: readonly string[]): Promise<Record<string, unknown>>; run(launcherUrl: string, module: string, name: string): Promise<void> }} SourceLoader */

// Node runs JavaScript, and Kit is TypeScript, so a launcher reaches Kit's modules through this loader. It is
// JavaScript itself because nothing could load it otherwise.
/**
 * @template T
 * @param {string} engineRoot
 * @param {(load: Load) => Promise<T>} use
 * @returns {Promise<T>}
 */
async function withKit(engineRoot, use) {
  const { createServer } = await import("vite");
  const { ViteNodeServer } = await import("vite-node/server");
  const { ViteNodeRunner } = await import("vite-node/client");
  const server = await createServer({
    root: engineRoot,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const loader = new ViteNodeServer(server, {
      deps: { external: ["typescript", "mdast-util-from-markdown"] },
    });
    const runner = new ViteNodeRunner({
      root: engineRoot,
      base: server.config.base,
      fetchModule: (id) => loader.fetchModule(id),
      resolveId: (id, importer) => loader.resolveId(id, importer),
    });
    return await use((name) => runner.executeFile(join(engineRoot, name)));
  } finally {
    await server.close();
  }
}

/** @type {SourceLoader} */
export const sourceLoader = {
  // Both paths are resolved, so a launcher invoked through an installed symlink still runs once.
  isMain(moduleUrl, entry = process.argv[1]) {
    if (entry === undefined) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  },
  // The named modules' exports, merged, for a caller that keeps using them after loading.
  load(engineRoot, modules) {
    return withKit(engineRoot, async (load) => {
      /** @type {Record<string, unknown>} */
      const exports = {};
      for (const module of modules) Object.assign(exports, await load(module));
      return exports;
    });
  },
  // A launcher in `scripts/` runs one Kit command: it hands the command its arguments and working directory,
  // with the terminal input adapter for a command that reads its input, and answers the terminal with the
  // command's output and exit status.
  async run(launcherUrl, module, name) {
    const engineRoot = decodeURIComponent(new URL("..", launcherUrl).pathname).replace(/\/$/, "");
    await withKit(engineRoot, async (load) => {
      const command = Reflect.get(await load(module), name);
      if (typeof command !== "function") throw new Error(`${module} exports no ${name}.`);
      const { terminalInput } = await load("src/substrate/adapters/terminal-input.ts");
      const response = await command({ engineRoot, args: process.argv.slice(2), cwd: process.cwd() }, terminalInput);
      process.stdout.write(String(Reflect.get(response, "stdout")));
      process.stderr.write(String(Reflect.get(response, "stderr")));
      process.exitCode = Number(Reflect.get(response, "exitCode"));
    });
  },
};
