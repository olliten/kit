import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";

export function moduleBinder(snapshot: Snapshot): Finding[] {
  const { srcRoot } = snapshot.config;
  const artifacts = new Set<string>();
  for (const file of snapshot.files) {
    if (file.type !== "source") continue;
    const at = placementOf(file.path, srcRoot);
    if (at.placed) artifacts.add(at.artifact);
  }
  const headingFiles = new Map<string, string[]>();
  for (const { name, file } of snapshot.headings) {
    headingFiles.set(name, [...(headingFiles.get(name) ?? []), file]);
  }

  const findings: Finding[] = [];
  for (const [name, files] of headingFiles) {
    if (!artifacts.has(name)) {
      const fix = `Create ${srcRoot}/${name}.ts, or remove the heading \`### ${name}\` from ${files.join(", ")}.`;
      findings.push(finding("R3", "no-file", name, fix));
    }
  }
  return findings.sort(byDebtKey);
}
