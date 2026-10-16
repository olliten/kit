import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve both paths so a CLI invoked through an installed symlink still runs once. */
export function isKitMain(moduleUrl, entry = process.argv[1]) {
  if (entry === undefined) return false;
  return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
}

/** Runs `use` with a loader for the Kit's TypeScript source, then releases the loader. */
export async function withKit(engineRoot, use) {
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
