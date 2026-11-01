import { configuredKit, kitConfig } from "../../core/compositions/kit-configuration.js";
import type { CommandResponse } from "../../core/primitives/command.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../core/primitives/default-config.js";
import { textFiles } from "../adapters/text-files.js";

// A config error is the app's to fix before anything is checked, so it answers the command instead of becoming a
// finding a baseline could hold, and it names the file and every issue rather than a stack.
export function readConfig(configPath: string): { readonly config: KitConfig } | { readonly failure: CommandResponse } {
  try {
    return { config: configuredKit(DEFAULT_CONFIG, kitConfig(textFiles.read(configPath))) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { failure: { stdout: "", stderr: `Kit config ${configPath}: ${message}\n`, exitCode: 1 } };
  }
}
