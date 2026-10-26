import { JSON_SCHEMA, load } from "js-yaml";
import type { KitConfig } from "../primitives/default-config.js";

type Declaration = { readonly [key: string]: unknown };
type Zone = "core" | "shell" | "substrate";

const isRecord = (value: unknown): value is Declaration =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isTexts = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isText);
const isZone = (value: unknown): value is Zone => value === "core" || value === "shell" || value === "substrate";
const texts = (value: unknown, what: string): readonly string[] => {
  if (value === undefined) return [];
  if (!isTexts(value)) throw new Error(`The Kit configuration's ${what} must list text entries.`);
  return value;
};

// The posix form of a relative or absolute path, with `.` and `..` resolved as far as the path allows.
export function normalizedPath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else if (part !== ".." || !absolute) parts.push(part);
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined || ".";
}

// A declared location is relative, inside the app, and names no pattern, so the walk can match it by prefix.
const relativeLocation = (path: string): boolean =>
  !path.includes("\\") && !/^[a-z]:/i.test(path) && !/[*?{}[\]!]/.test(path) && !path.startsWith("/");

export function kitConfig(text: string): Declaration {
  const fences = [...text.matchAll(/^```yaml[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  const fence = fences[0]?.[1];
  if (fences.length !== 1 || fence === undefined)
    throw new Error("A Kit configuration must contain one YAML configuration fence");
  const config = load(fence, { schema: JSON_SCHEMA });
  if (!isRecord(config)) throw new Error("A Kit configuration must declare a configuration mapping");
  return config;
}

export function configuredKit(defaults: KitConfig, declaration: Declaration): KitConfig {
  const roots = declaration["roots"];
  const src = isRecord(roots) ? roots["src"] : undefined;
  const spec = isRecord(roots) ? roots["spec"] : undefined;
  const oracle = isRecord(roots) ? roots["oracle"] : undefined;
  if (
    !isRecord(roots) ||
    Object.keys(roots).some((name) => !["src", "spec", "oracle"].includes(name)) ||
    !isText(spec) ||
    !spec.trim() ||
    !isText(oracle) ||
    !oracle.trim() ||
    !((isText(src) && src.trim()) || (isTexts(src) && src.length > 0 && src.every((path) => path.trim())))
  )
    throw new Error(
      "Declare roots.src as one path or a list of code roots, and roots.spec and roots.oracle as single paths.",
    );
  const terms = declaration["terms"];
  if (terms !== undefined && !isText(terms)) throw new Error("Declare the terms file as a path.");
  const separator = declaration["claim-separator"];
  if (separator !== undefined && !isText(separator)) throw new Error("Declare the claim separator as text.");
  return {
    ...defaults,
    srcRoot: isText(src) ? src.replace(/\/$/, "") : src.map((path) => path.replace(/\/$/, "")).sort(),
    specRoot: spec.replace(/\/$/, ""),
    oracleRoot: oracle.replace(/\/$/, ""),
    ...(declaration["layout"] === undefined ? {} : { layout: configuredLayout(declaration["layout"]) }),
    termsFile: terms ?? defaults.termsFile,
    ...(separator === undefined ? {} : { claimSeparator: separator }),
    legacyAreas: texts(declaration["legacy-areas"], "legacy-areas"),
    legacyZones: legacyZones(declaration["legacy-zones"]),
    exceptions: texts(declaration["exceptions"], "exceptions"),
    dependencyExclusions: dependencyExclusions(declaration["dependency-exclusions"]),
    ignore: ignoredPaths(declaration["ignore"]),
    adapters: adapters(declaration["adapters"]),
    packages: packages(declaration["packages"]),
  };
}

function configuredLayout(declaration: unknown): { readonly legacy: readonly string[] } {
  const legacy = isRecord(declaration) ? declaration["legacy"] : undefined;
  if (!isRecord(declaration) || Object.keys(declaration).some((key) => key !== "legacy") || !Array.isArray(legacy))
    throw new Error("Declare layout as a mapping with a legacy list of relative files or directories.");
  const locations = legacy.map((path: unknown) => {
    if (
      !isText(path) ||
      !path ||
      path.trim() !== path ||
      !relativeLocation(path) ||
      path.replace(/\/$/, "").split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Layout legacy locations must be relative files or directories without patterns or dot segments.");
    return path.replace(/\/$/, "");
  });
  return { legacy: [...new Set(locations)].sort() };
}

function legacyZones(declared: unknown): NonNullable<KitConfig["legacyZones"]> {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error("The Kit configuration's legacy-zones must list rows.");
  return declared.map((row: unknown) => {
    const zone = isRecord(row) ? row["zone"] : undefined;
    const root = isRecord(row) ? row["root"] : undefined;
    const files = isRecord(row) ? row["files"] : undefined;
    if (isZone(zone) && isText(root)) return { root, zone };
    if (isZone(zone) && isTexts(files)) return { files, zone };
    throw new Error("A legacy zone row declares a zone and either a root or a list of files.");
  });
}

function dependencyExclusions(declared: unknown): NonNullable<KitConfig["dependencyExclusions"]> {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error("The Kit configuration's dependency-exclusions must list rules.");
  return declared.map((rule: unknown) => {
    const from = isRecord(rule) ? rule["from"] : undefined;
    const to = isRecord(rule) ? rule["to"] : undefined;
    const imports = isRecord(rule) ? rule["imports"] : undefined;
    const reach = isRecord(rule) ? rule["reach"] : undefined;
    if (
      isText(from) &&
      isText(to) &&
      (imports === "all" || imports === "runtime") &&
      (reach === "direct" || reach === "transitive")
    )
      return { from, to, imports, reach };
    throw new Error("A dependency exclusion declares from, to, imports (all or runtime) and reach (direct or transitive).");
  });
}

function adapters(declared: unknown): NonNullable<KitConfig["adapters"]> {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error("The Kit configuration's adapters must list registrations.");
  return declared.map((row: unknown) => {
    if (!isRecord(row)) throw new Error("An adapter registration is a mapping.");
    const { module, export: name, capability, kind, zones, contract, primitives, globals } = row;
    const contractType = isRecord(contract) ? contract["type"] : undefined;
    if (
      !isText(module) ||
      !isText(name) ||
      !isText(capability) ||
      (kind !== "external" && kind !== "produce" && kind !== "apply") ||
      !Array.isArray(zones) ||
      !zones.every(isZone) ||
      (contract !== undefined && !isText(contractType)) ||
      (primitives !== undefined &&
        !(Array.isArray(primitives) && primitives.every((each) => each === "clock" || each === "randomness")))
    )
      throw new Error(
        "An adapter registration declares module, export, capability, kind (external, produce or apply) and zones, " +
          "and optionally a contract type, primitives (clock or randomness), globals and packages.",
      );
    return {
      module,
      export: name,
      capability,
      kind,
      zones,
      ...(isText(contractType) ? { contract: { type: contractType } } : {}),
      ...(primitives === undefined ? {} : { primitives }),
      ...(globals === undefined ? {} : { globals: texts(globals, "adapter globals") }),
      ...(row["packages"] === undefined ? {} : { packages: texts(row["packages"], "adapter packages") }),
    };
  });
}

function packages(declared: unknown): NonNullable<KitConfig["packages"]> {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error("The Kit configuration's packages must list package contracts.");
  return declared.map((row: unknown) => {
    const name = isRecord(row) ? row["name"] : undefined;
    const capabilities = isRecord(row) ? row["capabilities"] : undefined;
    const entrypointExports = isRecord(row) ? row["entrypointExports"] : undefined;
    if (!isText(name) || !isTexts(capabilities) || (entrypointExports !== undefined && !isTexts(entrypointExports)))
      throw new Error("A package contract declares a name, its capabilities and optionally its entrypoint exports.");
    return { name, capabilities, ...(entrypointExports === undefined ? {} : { entrypointExports }) };
  });
}

// An ignored path is exact and inside the app, so the walk can skip it by prefix without reading it.
export function ignoredPaths(declared: unknown): string[] {
  if (declared === undefined || declared === null) return [];
  const paths: unknown = isText(declared) ? [declared] : declared;
  if (!Array.isArray(paths)) throw new Error("The Kit configuration's ignore must list relative paths.");
  return [
    ...new Set(
      paths.map((path: unknown) => {
        const normalized = isText(path) ? normalizedPath(path) : "";
        if (!isText(path) || !normalized || normalized === "." || !relativeLocation(path) || normalized.split("/").includes(".."))
          throw new Error(
            `The Kit configuration's ignore entry ${JSON.stringify(path)} must be a relative path inside the app, without patterns.`,
          );
        return normalized;
      }),
    ),
  ].sort();
}

// The directories a test runner discovers: the proof root, and only the legacy test roots an app declares.
export function testRoots(declaration: Declaration): string[] {
  const legacy = declaration["legacy-test-roots"] === undefined ? [] : declaration["legacy-test-roots"];
  if (!Array.isArray(legacy))
    throw new Error("The Kit configuration's legacy-test-roots must list relative directories.");
  const roots = isRecord(declaration["roots"]) ? declaration["roots"]["oracle"] : undefined;
  return [
    ...new Set(
      [...legacy, roots].map((root: unknown) => {
        const normalized = isText(root) ? normalizedPath(root) : "";
        if (
          !isText(root) ||
          !root ||
          root.trim() !== root ||
          !relativeLocation(root) ||
          root.split("/").some((part) => part === "." || part === "..") ||
          normalized === "."
        )
          throw new Error("Proof roots must be relative directories without patterns or dot segments.");
        return normalized;
      }),
    ),
  ];
}

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
