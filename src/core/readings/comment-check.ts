import { ZONES } from "../primitives/zones.js";
import { proofOf } from "./binder.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { LAYERS, placementOf } from "./placement-of.js";
import type { Snapshot } from "./snapshot.js";

// R3, comments: a comment in a placed source or test file cites nothing and carries no debt. A citation
// is a claim anchor in the config's form, a Markdown file, or a module's identity: the path and the
// imports already link the code to all three, so a written citation is a second link that goes stale.
// A debt marker is one of the config's words, written whole in capitals. Retired words in comments are
// the name check's; restating a claim is held for review. Legacy files are not held.
export function commentCheck(snapshot: Snapshot): Finding[] {
  const { srcRoot, oracleRoot, anchor, debtMarkers } = snapshot.config;
  const identity = new RegExp(
    `\\b(?:${ZONES.join("|")})/(?:${LAYERS.join("|")})/[a-z0-9-]+\\b`,
    "g",
  );
  const citations = [new RegExp(anchor, "g"), /[\w./-]+\.md\b/g, identity];
  const marker = new RegExp(`\\b(?:${debtMarkers.join("|")})\\b`, "g");
  const findings: Finding[] = [];

  for (const { file, line, text } of snapshot.comments) {
    const test = file.startsWith(`${oracleRoot}/`);
    const at = placementOf(file, srcRoot);
    const proof = test && proofOf(file, oracleRoot) !== null;
    if (!at.placed && !proof) continue;
    const path = at.placed ? at.artifact : file;
    for (const cite of citations.flatMap((re) => [...text.matchAll(re)].map((m) => m[0]))) {
      const fix = `In ${file}:${line}, delete the citation \`${cite}\`: the path and the imports already link this code.`;
      findings.push(finding("R3", "comment-citation", path, fix, cite));
    }
    for (const [word] of text.matchAll(marker)) {
      const fix = `In ${file}:${line}, move the \`${word}\` to a debt list entry and delete it from the comment.`;
      findings.push(finding("R3", "comment-debt", path, fix, word));
    }
  }
  // One finding per debt key, however many comments repeat a citation.
  return [...new Map(findings.map((f) => [f.debtKey, f])).values()].sort(byDebtKey);
}
