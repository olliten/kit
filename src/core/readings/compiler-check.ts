import type { Snapshot } from "../primitives/snapshot.js";
import { type CapabilityContext, type CapabilityFinding, capabilityFinding, capabilityLimit } from "./capability-context.js";

// Authority is read from the compiler, so a checked file must be in a project, compiled strictly and without
// errors, and its values expressed through their checked types rather than escape hatches.
export function compilerCheck(snapshot: Snapshot, context: CapabilityContext): CapabilityFinding[] {
  const projects = snapshot.compiler?.projects ?? [];
  const checked = new Set(context.files);
  const findings: CapabilityFinding[] = [];
  const add = (rule: "R1" | "R2", check: string, path: string, fix: string, detail: string): void => {
    findings.push(capabilityFinding(snapshot, context.startups, rule, check, path, fix, detail));
  };
  for (const path of context.files)
    if (projects.length === 0) findings.push(capabilityLimit("compiler-boundary", path, "No compiler project covers the source."));
    else if (!projects.some((project) => project.files.includes(path) || project.ambientFiles.includes(path)))
      findings.push(capabilityLimit("compiler-boundary", path, "The source is excluded from every compiler project."));
  for (const project of projects) {
    if (!project.settings.noImplicitAny || !project.settings.strictNullChecks)
      for (const path of project.files)
        if (checked.has(path))
          add("R1", "compiler-settings", path, "Restore strict implicit-value and null checking for this project.", project.file);
    if (project.diagnostics.some((diagnostic) => diagnostic.category === "error" && diagnostic.file === null))
      for (const path of project.files)
        if (checked.has(path))
          findings.push(
            capabilityLimit("compiler-configuration", path, "The effective compiler configuration has an error.", project.file),
          );
    for (const escape of project.escapes)
      if (checked.has(escape.file))
        add(
          "R1",
          "type-escape",
          escape.file,
          "Express this value through its checked type without an escape hatch.",
          `${escape.kind}:${escape.site ?? escape.start}`,
        );
    for (const diagnostic of project.diagnostics)
      if (diagnostic.category === "error" && diagnostic.file !== null && checked.has(diagnostic.file))
        add(
          "R1",
          "compiler",
          diagnostic.file,
          "Resolve this compiler diagnostic before claiming the boundary checked.",
          `${diagnostic.code}:${diagnostic.start}`,
        );
  }
  return findings;
}
