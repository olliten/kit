import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";
import type { Snapshot } from "./snapshot.js";

export function proofOf(
  path: string,
  root: string,
): { readonly topic: string; readonly anchor: string } | null {
  if (!path.startsWith(`${root}/`)) return null;
  const match = /^([\w-]+)\/([\w-]+)(?:\.[\w-]+)*\.test\.ts$/.exec(path.slice(root.length + 1));
  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { topic: match[1], anchor: match[2] };
}

export function binder(snapshot: Snapshot): Finding[] {
  const { srcRoot, oracleRoot } = snapshot.config;
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
  {
    const claims = snapshot.claims ?? [];
    const homes = new Map<string, typeof claims>();
    const proofs = new Set<string>();
    for (const claim of claims)
      homes.set(claim.anchor, [...(homes.get(claim.anchor) ?? []), claim]);
    for (const [anchor, claims] of homes)
      if (claims.length > 1)
        findings.push(
          finding("R3", "duplicate-claim", anchor, "Keep one declaration home for this claim."),
        );
    for (const file of snapshot.files) {
      if (file.type !== "test" || !file.path.startsWith(`${oracleRoot}/`)) continue;
      const proof = proofOf(file.path, oracleRoot);
      if (proof === null) {
        findings.push(
          finding(
            "R3",
            "test-name",
            file.path,
            "Use <topic>/<claim-anchor>.<variant>.test.ts, with an optional variant.",
          ),
        );
        continue;
      }
      const home = claims.find(
        (claim) =>
          claim.anchor === proof.anchor &&
          claim.file === `${snapshot.config.specRoot}/${proof.topic}.md`,
      );
      if (home === undefined)
        findings.push(
          finding("R3", "unknown-claim", file.path, "Name a claim declared in this test's topic."),
        );
      else proofs.add(`${home.file}:${home.anchor}`);
    }
    for (const claim of claims)
      if (!proofs.has(`${claim.file}:${claim.anchor}`))
        findings.push(
          finding(
            "R3",
            "missing-proof",
            claim.file,
            "Prove this claim through a topic claim-first test.",
            claim.anchor,
          ),
        );
  }
  return findings.sort(byDebtKey);
}
