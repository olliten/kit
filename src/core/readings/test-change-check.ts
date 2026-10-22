import type { ChangeHistory } from "../primitives/change-history.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { proofOf } from "./claim-proof-binder.js";
import { type Finding, byDebtKey, finding } from "./finding.js";

// A claim's test is its promise's teeth, so editing one without its topic is how a promise weakens unseen.
// A test that only adds proof, or leaves with its claim, changes no promise; nor does a shared proof module.
export function testChangeCheck(snapshot: Snapshot, history: ChangeHistory): Finding[] {
  const { oracleRoot, specRoot } = snapshot.config;
  const changed = new Set(history.files.map((file) => file.path));
  const fixed = new Set(
    history.messages.flatMap((message) =>
      [...message.matchAll(/^Test fix: (\S+): \S/gm)].flatMap((match) => (match[1] ? [match[1]] : [])),
    ),
  );
  const topics = new Set((snapshot.claims ?? []).map((claim) => claim.file));
  return history.files
    .flatMap((file) => {
      const proof = file.status === "modified" ? proofOf(file.path, oracleRoot) : null;
      const topic = proof === null ? undefined : `${specRoot}/${proof.topic}.md`;
      if (topic === undefined || !topics.has(topic) || changed.has(topic) || fixed.has(file.path)) return [];
      return [
        finding(
          "R3",
          "test-change",
          file.path,
          `Change ${topic} with this test, or say why in a commit line "Test fix: ${file.path}: <reason>".`,
        ),
      ];
    })
    .sort(byDebtKey);
}
