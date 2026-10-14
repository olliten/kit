import { resolve } from "node:path";
import { JSON_SCHEMA, load } from "js-yaml";

export function kitConfig(text) {
  const fences = [...text.matchAll(/^```yaml[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (fences.length !== 1)
    throw new Error("A Kit configuration must contain one YAML configuration fence");
  const config = load(fences[0][1], { schema: JSON_SCHEMA });
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("A Kit configuration must declare a configuration mapping");
  return config;
}

export function configuredKit(defaults, declaration) {
  return {
    ...defaults,
    srcRoot: declaration.roots.src.replace(/\/$/, ""),
    specRoot: declaration.roots.spec.replace(/\/$/, ""),
    oracleRoot: declaration.roots.oracle.replace(/\/$/, ""),
    termsFile: declaration.terms,
    claimSeparator: declaration["claim-separator"] ?? defaults.claimSeparator,
    legacyAreas: declaration["legacy-areas"] ?? [],
    adapters: declaration.adapters ?? [],
    packages: declaration.packages ?? [],
  };
}

export function kitCheckPaths(args, engineRoot) {
  const option = (name) => {
    const values = [];
    for (let index = 0; index < args.length; index++) {
      const argument = args[index];
      if (argument.startsWith(`--${name}=`)) values.push(argument.slice(name.length + 3));
      else if (argument === `--${name}`) values.push(args[index + 1]);
    }
    if (values.length > 1 || values.some((value) => !value || value.startsWith("--")))
      throw new Error(`Supply one nonempty --${name} path.`);
    return values[0];
  };
  const root = resolve(engineRoot, option("root") ?? ".");
  const config = option("config");
  const baseline = option("baseline");
  if (root !== engineRoot && (!config || !baseline))
    throw new Error("A different governed root requires its --config and --baseline paths.");
  return {
    root,
    configPath: resolve(engineRoot, config ?? "kit/config.md"),
    baselinePath: resolve(engineRoot, baseline ?? "kit/debt/legacy.json"),
  };
}
