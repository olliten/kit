import type { Snapshot } from "../primitives/snapshot.js";
import {
  type AuthorityPart,
  type CapabilityContext,
  type CapabilityFinding,
  capabilityFinding,
  capabilityLimit,
} from "./capability-context.js";

// What a module acquires by importing outside the checked code. A package an adapter declares is that adapter's
// raw operation, whatever a package row says; an entrypoint package grants its capabilities only for selected
// named exports at an exact entrypoint; a declared package grants its row; anything else is a limit.
export function importAuthority(snapshot: Snapshot, context: CapabilityContext): AuthorityPart {
  const checked = new Set(context.files);
  const { startups } = context;
  const grants: { file: string; capability: string }[] = [];
  const rawFailures: string[] = [];
  const findings: CapabilityFinding[] = [];
  const grant = (file: string, capabilities: readonly string[]): void => {
    for (const capability of capabilities) grants.push({ file, capability });
  };
  for (const edge of (snapshot.compiler?.projects ?? []).flatMap((project) => project.imports)) {
    if (edge.typeOnly || !checked.has(edge.file) || (edge.target !== null && checked.has(edge.target))) continue;
    const packageName = edge.specifier.startsWith("@")
      ? edge.specifier.split("/").slice(0, 2).join("/")
      : edge.specifier.split("/")[0];
    const declaration = snapshot.config.packages?.find((row) => row.name === packageName);
    const bound = context.adapters.filter(
      ({ adapter }) => adapter.kind === "external" && packageName !== undefined && adapter.packages?.includes(packageName) === true,
    );
    const owners = bound.filter(({ path }) => path === edge.file);
    const local = edge.specifier.startsWith(".") || edge.specifier.startsWith("#");
    if (bound.length > 0 && !local) {
      for (const { adapter } of owners.length > 0 ? owners : bound) {
        grant(edge.file, [adapter.capability]);
        if (owners.length === 0) rawFailures.push(`${edge.file}:${adapter.capability}`);
      }
      if (owners.length === 0)
        findings.push(
          capabilityFinding(
            snapshot,
            startups,
            "R1",
            "package-import",
            edge.file,
            "Import this package only in the capability adapter that declares it, and use that adapter's contract here.",
            packageName ?? edge.specifier,
          ),
        );
    } else if (declaration?.entrypointExports !== undefined) {
      const named = edge.namedImports;
      if (
        startups.includes(edge.file) &&
        edge.specifier === declaration.name &&
        named !== undefined &&
        named !== null &&
        named.length > 0 &&
        named.every((name) => declaration.entrypointExports?.includes(name))
      )
        grant(edge.file, declaration.capabilities);
      else
        findings.push(
          capabilityLimit(
            "entrypoint-package",
            edge.file,
            "This package contract permits only selected named runtime exports in an exact declared entrypoint.",
            edge.specifier,
          ),
        );
    } else if (declaration !== undefined && !local) grant(edge.file, declaration.capabilities);
    else
      findings.push(
        capabilityLimit(
          "external-boundary",
          edge.file,
          "This runtime import has no classified local source or adapter authority.",
          edge.specifier,
        ),
      );
  }
  return { grants, natives: [], globalWindow: [], rawFailures, findings };
}
