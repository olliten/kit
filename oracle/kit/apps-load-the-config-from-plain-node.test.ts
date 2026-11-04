import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { configuredKit, kitConfig } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { testRoots } from "../../src/core/readings/test-roots.js";
import { configuration } from "../../src/substrate/compositions/configuration-runner.mjs";
import { sourceLoader } from "../../src/substrate/adapters/source-loader.mjs";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("an app's script reads the config and test roots the commands read, without a build", async () => {
  const loaded = await configuration();
  const text = readFileSync(new URL("../../self-config.md", import.meta.url), "utf8");
  const read = Reflect.get(loaded, "kitConfig");
  const configured = Reflect.get(loaded, "configuredKit");
  const roots = Reflect.get(loaded, "testRoots");
  if (typeof read !== "function" || typeof configured !== "function" || typeof roots !== "function")
    throw new Error("The configuration runner did not load its readers.");
  expect(configured(DEFAULT_CONFIG, read(text))).toEqual(configuredKit(DEFAULT_CONFIG, kitConfig(text)));
  expect(roots(read(text))).toEqual(testRoots(kitConfig(text)));
  expect(await configuration()).toBe(loaded);
});

test("loading explicit Kit modules does not discover application configuration, environment or PostCSS", async () => {
  const project = temporaryProjects.open("kit-source-loader-bounds-");
  try {
    project.write({
      "package.json": JSON.stringify({ type: "module", postcss: { plugins: { "missing-plugin-that-must-not-load": {} } } }),
      "vite.config.mjs": "throw new Error('Application config must not load.');\n",
      "postcss.config.mjs": "throw new Error('PostCSS discovery must not load.');\n",
      ".env": "VITE_KIT_LOADER_TRAP_X=loaded\n",
      "src/value.ts": "import './style.css';\nexport const value: number = 42;\nexport const leaked = import.meta.env.VITE_KIT_LOADER_TRAP_X;\n",
      "src/style.css": ".fixture { color: red; }\n",
    });
    const loaded = await sourceLoader.load(project.root, ["src/value.ts"]);
    expect(loaded["value"]).toBe(42);
    expect(loaded["leaked"]).toBeUndefined();
  } finally {
    project.dispose();
  }
});
