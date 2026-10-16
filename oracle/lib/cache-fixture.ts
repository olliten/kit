import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { compilerWorkspace } from "../../src/substrate/adapters/compiler.js";
import { filesystem } from "../../src/substrate/adapters/filesystem.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const cacheSource =
  process.env.KIT_CACHE_SOURCE ?? new URL("../../scripts/kit-snapshot-cache.mjs", import.meta.url).href;
export const { cachedKitCheck, cacheDirectory } = await import(cacheSource);
export const adapters = { filesystem, compiler: compilerWorkspace };

// A small app the real reader extracts: a compiled project that imports a package, an `evidence/` folder
// the config ignores, and a package README the compiler never opens.
export const CACHE_APP: Readonly<Record<string, string>> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["src/**/*.ts"],
  }),
  "src/core/primitives/value.ts": "export const value = 7;\n",
  "src/core/readings/double.ts":
    'import type { Shape } from "a";\nimport { value } from "../primitives/value.js";\n' +
    "export const double = (shape: Shape): number => shape.n * value * 2;\n",
  "spec/terms.md": "# Terms\n\n- **value** — a number.\n",
  "spec/numbers.md":
    "# Numbers\n\nNumbers.\n\n## Values\n\n- A value doubles ({{double}}). · {#value-doubles}\n",
  "node_modules/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", types: "index.d.ts" }),
  "node_modules/a/index.d.ts": "export interface Shape { readonly n: number; }\n",
  "node_modules/a/README.md": "# a\n",
  "evidence/read-cost/1.json": "{}\n",
};

export const CACHE_CONFIG: KitConfig = { ...DEFAULT_CONFIG, ignore: ["evidence"] };

const roots: string[] = [];
export function removeCacheApps(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function scratch(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export function writeApp(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

// A cache app with its own store, counting extractions; `run` checks it with the identity checker, so its
// result is the snapshot the checker was given.
export function cacheApp(files: Readonly<Record<string, string>> = CACHE_APP) {
  const scratchRoot = scratch("kit-cache-proof-");
  const root = join(scratchRoot, "app");
  const cacheDir = join(scratchRoot, "cache");
  writeApp(root, files);
  let extractions = 0;
  let checks = 0;
  const read = (appRoot: string, config: KitConfig, trace: Parameters<typeof readSnapshot>[2]): Snapshot => {
    extractions++;
    return readSnapshot(appRoot, config, trace);
  };
  const check = (snapshot: Snapshot): Snapshot => {
    checks++;
    return snapshot;
  };
  const run = (
    config: KitConfig = CACHE_CONFIG,
  ): Promise<{ result: Snapshot; receipt: { reused: boolean } }> =>
    cachedKitCheck(root, config, read, check, adapters, { cacheDir });
  return {
    root,
    cacheDir,
    read,
    check,
    run,
    put: (path: string, text: string) => writeApp(root, { [path]: text }),
    counts: () => ({ extractions, checks }),
  };
}
