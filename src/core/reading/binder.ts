import { type Finding, byDebtKey, finding } from "./finding.js";
import { kindOf } from "./kind-of.js";
import type { Snapshot } from "./snapshot.js";

const TEST_REST = /^[^.]+\.test\.ts$/;

// R3, binding: `<zone>/<kind>/<name>` is one artifact in spec (heading), code (file) and oracle (tests
// `<name>.<law>.test.ts`). Files and tests outside the `<zone>/<kind>/` layout are legacy and not held.
export function binder(snapshot: Snapshot): Finding[] {
  const { srcRoot, oracleRoot } = snapshot.config;
  const artifacts = new Set<string>();
  for (const file of snapshot.files) {
    if (file.type !== "source") continue;
    const at = kindOf(file.path, srcRoot);
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
    if (files.length > 1) {
      const fix = `Keep exactly one heading \`### ${name}\`; it now appears in ${files.join(", ")}.`;
      findings.push(finding("R3", "duplicate-heading", name, fix));
    }
  }
  for (const artifact of artifacts) {
    if (!headingFiles.has(artifact)) {
      const fix = `Add the heading \`### ${artifact}\` to one spec topic file.`;
      findings.push(finding("R3", "no-heading", artifact, fix));
    }
  }
  for (const file of snapshot.files) {
    if (file.type !== "test") continue;
    const at = kindOf(file.path, oracleRoot);
    if (!at.placed) continue;
    if (!TEST_REST.test(at.rest)) {
      const fix = `Rename the test to ${oracleRoot}/${at.artifact}.<law>.test.ts, with one law segment.`;
      findings.push(finding("R3", "test-name", file.path, fix));
    } else if (!artifacts.has(at.artifact)) {
      const fix = `Rename the test so its prefix names an artifact, or create ${srcRoot}/${at.artifact}.ts.`;
      findings.push(finding("R3", "orphan-test", file.path, fix));
    }
  }
  return findings.sort(byDebtKey);
}
