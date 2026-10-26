import { normalizedPath } from "./config-values.js";

// Paths the caller gives resolve against where the caller runs; the defaults check the Kit itself.
export function kitCheckPaths(
  args: readonly string[],
  engineRoot: string,
  cwd: string,
): { readonly root: string; readonly configPath: string; readonly baselinePath: string } {
  const at = (base: string, path: string): string => normalizedPath(path.startsWith("/") ? path : `${base}/${path}`);
  const option = (name: string): string | undefined => {
    const values: (string | undefined)[] = [];
    args.forEach((argument, index) => {
      if (argument.startsWith(`--${name}=`)) values.push(argument.slice(name.length + 3));
      else if (argument === `--${name}`) values.push(args[index + 1]);
    });
    if (values.length > 1 || values.some((value) => !value || value.startsWith("--")))
      throw new Error(`Supply one nonempty --${name} path.`);
    return values[0];
  };
  const given = option("root");
  const root = given === undefined ? engineRoot : at(cwd, given);
  const config = option("config");
  const baseline = option("baseline");
  if (root !== engineRoot && (!config || !baseline))
    throw new Error("A different governed root requires its --config and --baseline paths.");
  return {
    root,
    configPath: config === undefined ? at(engineRoot, "self-config.md") : at(cwd, config),
    baselinePath: baseline === undefined ? at(engineRoot, "self-debt/legacy.json") : at(cwd, baseline),
  };
}
