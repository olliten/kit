import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { configuredKit, kitConfig } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { testRoots } from "../../src/core/readings/test-roots.js";
import { configuration } from "../../src/substrate/compositions/configuration-runner.mjs";

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
