import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import { DEFAULT_CONFIG } from "../../core/primitives/default-config.js";
import { configuredKit, kitConfig } from "../../core/compositions/kit-configuration.js";
import { normalizedPath } from "../../core/readings/config-values.js";
import { describeRefs, moduleRefs } from "../../core/readings/refs-description.js";
import { textFiles } from "../adapters/text-files.js";

// The spec files under a folder, by their path from the root.
function markdown(root: string, folder: string): string[] {
  if (!textFiles.exists(`${root}/${folder}`)) return [];
  return textFiles.entries(`${root}/${folder}`).flatMap((entry) =>
    entry.directory
      ? markdown(root, `${folder}/${entry.name}`)
      : entry.file && entry.name.endsWith(".md")
        ? [`${folder}/${entry.name}`]
        : [],
  );
}

// The claims a module keeps, for a governed root. As a read hook it takes the opened path from its input and
// answers in the hook's format, so an agent sees a module's promises when it opens the file.
export async function moduleClaims(root: string, configPath: string, target: string) {
  const config = configuredKit(DEFAULT_CONFIG, kitConfig(textFiles.read(configPath)));
  const relative = target.startsWith(`${root}/`) ? target.slice(root.length + 1) : target;
  const topics = markdown(root, config.specRoot).map((file) => ({ file, text: textFiles.read(`${root}/${file}`) }));
  const tests = Object.fromEntries(
    topics.map(({ file }) => {
      const topic = file.slice(config.specRoot.length + 1).replace(/\.md$/, "");
      const folder = `${root}/${config.oracleRoot}/${topic}`;
      return [topic, textFiles.exists(folder) ? textFiles.entries(folder).map((entry) => entry.name) : []];
    }),
  );
  return moduleRefs(config, relative, topics, tests);
}

export async function runRefs({ engineRoot, args: given, cwd, input }: CommandRequest): Promise<CommandResponse> {
  const args = [...given];
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index < 0 ? undefined : args.splice(index, 2)[1];
  };
  const hook = args.includes("--hook");
  if (hook) args.splice(args.indexOf("--hook"), 1);
  const chosen = option("root");
  const config = option("config");
  if (chosen !== undefined && config === undefined)
    throw new Error("A different governed root requires its --config path.");
  const at = (path: string): string => normalizedPath(path.startsWith("/") ? path : `${cwd}/${path}`);
  const root = chosen === undefined ? engineRoot : at(chosen);
  const configPath = config === undefined ? `${engineRoot}/self-config.md` : at(config);
  const event: unknown = hook ? JSON.parse(input()) : undefined;
  const toolInput: unknown = typeof event === "object" && event !== null ? Reflect.get(event, "tool_input") : undefined;
  const opened: unknown = typeof toolInput === "object" && toolInput !== null ? Reflect.get(toolInput, "file_path") : undefined;
  const target = hook ? opened : args[0];
  if (typeof target !== "string" || !target)
    throw new Error("Name a module, or a source path, to list the claims it keeps.");
  const refs = await moduleClaims(root, configPath, target);
  if (refs === null) return { stdout: "", stderr: "", exitCode: 0 };
  const text = describeRefs(refs);
  return {
    stdout: hook
      ? JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }) + "\n"
      : text + "\n",
    stderr: "",
    exitCode: 0,
  };
}
