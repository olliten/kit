import type { Snapshot } from "../primitives/snapshot.js";
import { type CapabilityFinding, capabilityLimit, checkedFiles, placed, zoneOf } from "./capability-context.js";
import { finding } from "./finding.js";
import { legacyCodeOf, proofOf, rootOf } from "./placement-of.js";

// Which files are executable entrypoints: every checked claim proof, and each declared exception that is an exact
// existing file outside every zone. A package
// that permits selected exports only at entrypoints must declare them as one distinct, named contract.
export function startupCheck(snapshot: Snapshot): {
  readonly startups: readonly string[];
  readonly findings: readonly CapabilityFinding[];
} {
  const roots = snapshot.config.srcRoot;
  const packages = snapshot.config.packages ?? [];
  for (const row of packages) {
    if (row.entrypointExports === undefined) continue;
    if (
      !row.name ||
      row.name.trim() !== row.name ||
      /^[.#/]/.test(row.name) ||
      !Array.isArray(row.capabilities) ||
      row.capabilities.length === 0 ||
      Array.from(row.capabilities).some((capability) => typeof capability !== "string" || !capability.trim()) ||
      !Array.isArray(row.entrypointExports) ||
      row.entrypointExports.length === 0 ||
      Array.from(row.entrypointExports).some((name) => typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name)) ||
      new Set(row.entrypointExports).size !== row.entrypointExports.length ||
      packages.filter((other) => other.name === row.name).length !== 1
    )
      throw new Error("Declare one effectful entrypoint package contract with distinct named exports.");
  }
  const files = checkedFiles(snapshot);
  const startups: string[] = [];
  const findings: CapabilityFinding[] = [];
  for (const path of snapshot.config.exceptions ?? []) {
    if (rootOf(path, roots) === undefined && !legacyCodeOf(path, snapshot.config.layout?.legacy)) continue;
    if (
      !files.includes(path) ||
      /[*?{}[\]\\]/.test(path) ||
      path.split("/").some((part) => part === "." || part === ".." || part === "") ||
      placed(snapshot, path) !== null ||
      zoneOf(snapshot, path) !== undefined
    )
      findings.push({
        ...capabilityLimit(
          "startup-placement",
          path,
          "Directory, pattern, missing-code and zoned-module exceptions grant no entrypoint permission.",
          path,
        ),
        ...finding(
          "R2",
          "startup-placement",
          path,
          "Declare only an exact existing executable entrypoint outside every zone.",
          path,
        ),
      });
    else startups.push(path);
  }
  for (const path of files)
    if (proofOf(path, snapshot.config.oracleRoot) !== null && !startups.includes(path)) startups.push(path);
  return { startups, findings };
}
