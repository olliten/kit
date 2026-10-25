import { posix, resolve } from "node:path";
import { JSON_SCHEMA, load } from "js-yaml";

/** @param {string} text
 * @returns {Record<string, unknown>}
 */
export function kitConfig(text) {
  const fences = [...text.matchAll(/^```yaml[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (fences.length !== 1)
    throw new Error("A Kit configuration must contain one YAML configuration fence");
  const config = load(fences[0][1], { schema: JSON_SCHEMA });
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("A Kit configuration must declare a configuration mapping");
  return config;
}

/** @param {import("../src/core/primitives/default-config.js").KitConfig} defaults
 * @param {Record<string, unknown>} declaration
 * @returns {import("../src/core/primitives/default-config.js").KitConfig}
 */
export function configuredKit(defaults, declaration) {
  const roots = declaration.roots;
  if (
    !roots ||
    typeof roots !== "object" ||
    Array.isArray(roots) ||
    Object.keys(roots).some((name) => !["src", "spec", "oracle"].includes(name)) ||
    ["spec", "oracle"].some((name) => typeof roots[name] !== "string" || !roots[name].trim()) ||
    !(
      (typeof roots.src === "string" && roots.src.trim()) ||
      (Array.isArray(roots.src) &&
        roots.src.length > 0 &&
        roots.src.every((path) => typeof path === "string" && path.trim()))
    )
  )
    throw new Error(
      "Declare roots.src as one path or a list of code roots, and roots.spec and roots.oracle as single paths.",
    );
  return {
    ...defaults,
    srcRoot:
      typeof roots.src === "string"
        ? roots.src.replace(/\/$/, "")
        : roots.src.map((path) => path.replace(/\/$/, "")).sort(),
    specRoot: declaration.roots.spec.replace(/\/$/, ""),
    oracleRoot: declaration.roots.oracle.replace(/\/$/, ""),
    ...(declaration.layout === undefined ? {} : { layout: configuredLayout(declaration.layout) }),
    termsFile: declaration.terms,
    claimSeparator: declaration["claim-separator"] ?? defaults.claimSeparator,
    legacyAreas: declaration["legacy-areas"] ?? [],
    legacyZones: declaration["legacy-zones"] ?? [],
    exceptions: declaration.exceptions ?? [],
    dependencyExclusions: declaration["dependency-exclusions"] ?? [],
    ignore: ignoredPaths(declaration.ignore),
    adapters: declaration.adapters ?? [],
    packages: declaration.packages ?? [],
  };
}

/** @param {unknown} declaration
 * @returns {{legacy: string[]}}
 */
function configuredLayout(declaration) {
  if (
    !declaration || typeof declaration !== "object" || Array.isArray(declaration) ||
    Object.keys(declaration).some((key) => key !== "legacy") ||
    !Array.isArray(declaration.legacy)
  ) throw new Error("Declare layout as a mapping with a legacy list of relative files or directories.");
  const legacy = declaration.legacy.map((path) => {
    if (
      typeof path !== "string" || !path || path.trim() !== path ||
      /[\\*?{}[\]!]/.test(path) || /^[a-z]:/i.test(path) || posix.isAbsolute(path) ||
      path.replace(/\/$/, "").split("/").some((part) => !part || part === "." || part === "..")
    ) throw new Error("Layout legacy locations must be relative files or directories without patterns or dot segments.");
    return path.replace(/\/$/, "");
  });
  return { legacy: [...new Set(legacy)].sort() };
}

/** An ignored path is exact and inside the app, so the walk can skip it by prefix without reading it.
 * @param {unknown} declared
 * @returns {string[]}
 */
export function ignoredPaths(declared) {
  if (declared === undefined || declared === null) return [];
  const paths = typeof declared === "string" ? [declared] : declared;
  if (!Array.isArray(paths)) throw new Error("The Kit configuration's ignore must list relative paths.");
  return [
    ...new Set(
      paths.map((path) => {
        const normalized = typeof path === "string" ? posix.normalize(path).replace(/\/$/, "") : "";
        if (
          typeof path !== "string" ||
          !normalized ||
          normalized === "." ||
          path.includes("\\") ||
          /^[a-z]:/i.test(path) ||
          /[*?{}[\]!]/.test(path) ||
          posix.isAbsolute(path) ||
          normalized.split("/").includes("..")
        )
          throw new Error(
            `The Kit configuration's ignore entry ${JSON.stringify(path)} must be a relative path inside the app, without patterns.`,
          );
        return normalized;
      }),
    ),
  ].sort();
}

/** Paths the caller gives resolve against where the caller runs; the defaults check the Kit itself. */
export function kitCheckPaths(args, engineRoot, cwd = process.cwd()) {
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
  const given = option("root");
  const root = given === undefined ? engineRoot : resolve(cwd, given);
  const config = option("config");
  const baseline = option("baseline");
  if (root !== engineRoot && (!config || !baseline))
    throw new Error("A different governed root requires its --config and --baseline paths.");
  return {
    root,
    configPath: config === undefined ? resolve(engineRoot, "self-config.md") : resolve(cwd, config),
    baselinePath:
      baseline === undefined ? resolve(engineRoot, "self-debt/legacy.json") : resolve(cwd, baseline),
  };
}

/** Legacy proofs remain registered while the declared oracle root is adopted. */
/** @param {Record<string, unknown>} declaration
 * @returns {string[]}
 */
export function testRoots(declaration) {
  const legacy = declaration["legacy-test-roots"] === undefined ? [] : declaration["legacy-test-roots"];
  if (!Array.isArray(legacy))
    throw new Error("The Kit configuration's legacy-test-roots must list relative directories.");
  const roots = [...legacy, declaration.roots?.oracle].map((root) => {
    const normalized = typeof root === "string" ? posix.normalize(root).replace(/\/$/, "") : "";
    if (
      typeof root !== "string" ||
      !root ||
      root.trim() !== root ||
      root.includes("\\") ||
      /^[a-z]:/i.test(root) ||
      /[*?{}[\]!]/.test(root) ||
      posix.isAbsolute(root) ||
      root.split("/").some((part) => part === "." || part === "..") ||
      normalized === "."
    )
      throw new Error("Proof roots must be relative directories without patterns or dot segments.");
    return normalized;
  });
  return [...new Set(roots)];
}
