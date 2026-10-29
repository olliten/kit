import { JSON_SCHEMA, load } from "js-yaml";
import type { KitConfig } from "../primitives/default-config.js";
import { type Declaration, isRecord, isText, isTexts, isZone, normalizedPath, relativeLocation, texts } from "../readings/config-values.js";
import { configIssues } from "../readings/config-schema.js";
import { configuredLayout } from "../readings/layout-configuration.js";
import { legacyZones } from "../readings/legacy-zone-configuration.js";

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
  const issues = configIssues(declaration);
  if (issues.length > 0)
    throw new Error(
      [...issues.map((issue) => issue.message), "The keys Kit reads are listed in docs/reference.md."].join("\n"),
    );
  const app = declaration["app"];
  if (app !== undefined && !(isText(app) && app.trim())) throw new Error("Declare app as the app's name.");
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
  const runs = declaration["runs"];
  if (
    runs !== undefined &&
    !(
      isRecord(runs) &&
      isText(runs["record"]) &&
      relativeLocation(runs["record"]) &&
      !normalizedPath(runs["record"]).split("/").includes("..") &&
      isText(runs["each"]) &&
      runs["each"].includes("{test}") &&
      runs["each"].includes("{dir}")
    )
  )
    throw new Error(
      "Declare runs as a record path inside the app and the command that runs one test file {test} with its LCOV report in {dir}.",
    );
  const separator = declaration["claim-separator"];
  if (separator !== undefined && !isText(separator)) throw new Error("Declare the claim separator as text.");
  return {
    ...defaults,
    ...(isText(app) ? { app } : {}),
    srcRoot: isText(src) ? src.replace(/\/$/, "") : src.map((path) => path.replace(/\/$/, "")).sort(),
    specRoot: spec.replace(/\/$/, ""),
    oracleRoot: oracle.replace(/\/$/, ""),
    ...(declaration["layout"] === undefined ? {} : { layout: configuredLayout(declaration["layout"]) }),
    termsFile: terms ?? defaults.termsFile,
    ...(separator === undefined ? {} : { claimSeparator: separator }),
    ...(isRecord(runs) && isText(runs["record"]) && isText(runs["each"])
      ? { runs: { record: normalizedPath(runs["record"]), each: runs["each"] } }
      : {}),
    legacyAreas: texts(declaration["legacy-areas"], "legacy-areas"),
    legacyZones: legacyZones(declaration["legacy-zones"]),
    exceptions: texts(declaration["exceptions"], "exceptions"),
    dependencyExclusions: dependencyExclusions(declaration["dependency-exclusions"]),
    ignore: ignoredPaths(declaration["ignore"]),
    adapters: adapters(declaration["adapters"]),
    packages: packages(declaration["packages"]),
  };
}

function dependencyExclusions(declared: unknown): NonNullable<KitConfig["dependencyExclusions"]> {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error("The Kit configuration's dependency-exclusions must list rules.");
  return declared.map((rule: unknown, index) => {
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
    throw new Error(
      `dependency-exclusions[${index}]: a dependency exclusion declares from, to, imports (all or runtime) and reach (direct or transitive).`,
    );
  });
}

function adapters(declared: unknown): NonNullable<KitConfig["adapters"]> {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error("The Kit configuration's adapters must list registrations.");
  return declared.map((row: unknown, index) => {
    if (!isRecord(row)) throw new Error(`adapters[${index}]: an adapter registration is a mapping.`);
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
        `adapters[${index}]: an adapter registration declares module, export, capability, kind (external, produce or apply) ` +
          "and zones, and optionally a contract type, primitives (clock or randomness), globals and packages.",
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
  return declared.map((row: unknown, index) => {
    const name = isRecord(row) ? row["name"] : undefined;
    const capabilities = isRecord(row) ? row["capabilities"] : undefined;
    const entrypointExports = isRecord(row) ? row["entrypointExports"] : undefined;
    if (!isText(name) || !isTexts(capabilities) || (entrypointExports !== undefined && !isTexts(entrypointExports)))
      throw new Error(
        `packages[${index}]: a package contract declares a name, its capabilities and optionally its entrypoint exports.`,
      );
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
