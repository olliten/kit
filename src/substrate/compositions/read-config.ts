import { configuredKit, kitConfig } from "../../core/compositions/kit-configuration.js";
import type { CommandResponse } from "../../core/primitives/command.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../core/primitives/default-config.js";
import { missingHarnesses } from "../../core/readings/harness-configuration.js";
import { filesystem } from "../adapters/filesystem.js";
import { textFiles } from "../adapters/text-files.js";

// A config error is the app's to fix before anything is checked, so it answers the command instead of becoming a
// finding a baseline could hold, and it names the file and every issue rather than a stack. A harness file the
// app under `root` doesn't hold is such an error.
export function readConfig(configPath: string, root: string): { readonly config: KitConfig } | { readonly failure: CommandResponse } {
  try {
    const config = configuredKit(DEFAULT_CONFIG, kitConfig(textFiles.read(configPath)));
    const files = (config.harnesses ?? []).flatMap((harness) => ("file" in harness ? [harness.file] : []));
    const held = new Set(files.filter((file) => filesystem.kind(`${root}/${file}`) === "file"));
    const missing = missingHarnesses(config.harnesses ?? [], held);
    if (missing.length > 0) throw new Error(missing.join("\n"));
    return { config };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { failure: { stdout: "", stderr: `Kit config ${configPath}: ${message}\n`, exitCode: 1 } };
  }
}
