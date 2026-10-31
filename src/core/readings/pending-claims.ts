import type { KitConfig, Pending } from "../primitives/default-config.js";
import { isRecord, isText, relativeLocation } from "./config-values.js";
import { finding } from "./finding.js";
import type { GateFinding } from "./ratchet.js";

const shape = "declare a claim as <topic file>:<anchor>, or a test path, and the reason it is pending";

// The rows an app declares pending. Each names one claim or one test and the reason, so an exception to the
// check is deliberate; which keys a row may hold, the schema of the config already holds.
export function configuredPending(declared: unknown): Pending[] {
  if (!Array.isArray(declared)) throw new Error(`pending: list the pending rows; each row should ${shape}.`);
  const seen = new Map<string, number>();
  return declared.map((row: unknown, index) => {
    const at = `pending[${index}]`;
    if (!isRecord(row)) throw new Error(`${at}: a pending row is a mapping; ${shape}.`);
    const { claim, test, reason } = row;
    if ((claim === undefined) === (test === undefined)) throw new Error(`${at}: name a claim or a test, not ${claim === undefined ? "neither" : "both"}.`);
    if (claim !== undefined && !(isText(claim) && /^[^:\s]+\.md:[^:\s]+$/.test(claim) && relativeLocation(claim)))
      throw new Error(`${at}.claim: name the claim by its topic file and anchor, such as spec/proof.md:claims-have-one-home.`);
    if (test !== undefined && !(isText(test) && test.trim() && !/\s/.test(test) && relativeLocation(test)))
      throw new Error(`${at}.test: name the test by its relative path.`);
    if (!isText(reason) || !reason.trim()) throw new Error(`${at}.reason: declare the reason it is pending, as nonempty text.`);
    const subject = isText(claim) ? `claim ${claim}` : `test ${String(test)}`;
    const earlier = seen.get(subject);
    if (earlier !== undefined) throw new Error(`${at}: repeats pending[${earlier}], which already names the ${subject}.`);
    seen.set(subject, index);
    return isText(claim) ? { claim, reason } : { test: String(test), reason };
  });
}

// The debt key of the finding a row holds pending: a claim's missing proof, or a test's unknown claim.
const pendingKey = (row: Pending): string => ("claim" in row ? `R3:missing-proof:${row.claim}` : `R3:unknown-claim:${row.test}`);

// The findings with each one a row declares reported as pending, which never fails, and a placed violation for
// each row whose finding is gone: its debt is paid, so the row fails until it is removed, as paid debt does.
export function withPending(findings: readonly GateFinding[], config: KitConfig): GateFinding[] {
  const rows = new Map((config.pending ?? []).map((row) => [pendingKey(row), row]));
  const held = new Set<string>();
  const judged = findings.map((item): GateFinding => {
    const row = rows.get(item.debtKey);
    if (row === undefined) return item;
    held.add(item.debtKey);
    return { ...item, category: "pending", status: "pending", blocking: false, reason: row.reason };
  });
  const paid = [...rows]
    .filter(([key]) => !held.has(key))
    .map(([, row]): GateFinding => {
      const [path, detail] = "claim" in row ? splitClaim(row.claim) : [row.test, undefined];
      const fix =
        "claim" in row
          ? "This pending claim has its proof now, or names no claim: remove its row from `pending`."
          : "This pending test names a claim of its topic now, or is gone: remove its row from `pending`.";
      return { ...finding("R3", "paid-pending", path, fix, detail), category: "placed-violation", status: "violation", blocking: true, limit: "", reason: row.reason };
    });
  return [...judged, ...paid];
}

function splitClaim(claim: string): [string, string] {
  const at = claim.lastIndexOf(":");
  return [claim.slice(0, at), claim.slice(at + 1)];
}
