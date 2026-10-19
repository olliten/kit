import type {
  VerificationCheck,
  VerificationEvidence,
  VerificationPlan,
  VerificationState,
} from "../primitives/verification.js";

function validate(checks: readonly VerificationCheck[]): void {
  const byId = new Map(checks.map((check) => [check.id, check]));
  if (byId.size !== checks.length)
    throw new Error("Repeated verification identity");
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const check = byId.get(id);
    if (!check) throw new Error(`Missing prerequisite ${id}`);
    if (visiting.has(id)) throw new Error(`Cyclic prerequisite ${id}`);
    if (!Number.isFinite(check.strength) || check.strength < 0)
      throw new Error(`Invalid strength ${id}`);
    visiting.add(id);
    for (const dependency of check.needs) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const check of checks) visit(check.id);
}

export function verificationPlan(
  checks: readonly VerificationCheck[],
  evidence: readonly VerificationEvidence[],
  state: VerificationState = {},
): VerificationPlan {
  validate(checks);
  const completed = new Map(Object.entries(state.completed ?? {}));
  const running = new Set(state.running ?? []);
  const reused: string[] = [];
  const blocked: string[] = [];
  const used = new Map<string, number>();
  for (const check of checks) {
    const limit = state.capacity?.[check.resource];
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
      throw new Error(`Invalid capacity for ${check.resource}`);
    if (running.has(check.id))
      used.set(check.resource, (used.get(check.resource) ?? 0) + 1);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const check of checks) {
      if (completed.has(check.id) || running.has(check.id)) continue;
      if (check.needs.some((id) => completed.get(id) === false)) {
        completed.set(check.id, false);
        blocked.push(check.id);
        changed = true;
      } else if (
        state.reuse !== false &&
        check.inputs !== null &&
        check.needs.every((id) => completed.get(id) === true) &&
        evidence.some(
          (item) =>
            item.passed === true &&
            item.id === check.id &&
            item.inputs === check.inputs &&
            item.contract === check.contract &&
            Number.isFinite(item.strength) &&
            item.strength >= check.strength,
        )
      ) {
        completed.set(check.id, true);
        reused.push(check.id);
        changed = true;
      }
    }
  }
  const pending = checks.filter((check) => !completed.has(check.id));
  const ready = pending.filter((check) => {
    if (
      running.has(check.id) ||
      !check.needs.every((id) => completed.get(id) === true)
    )
      return false;
    const limit = state.capacity?.[check.resource] ?? checks.length;
    const held = used.get(check.resource) ?? 0;
    if (held >= limit) return false;
    used.set(check.resource, held + 1);
    return true;
  });
  return {
    ready,
    reused,
    blocked,
    pending: pending.map((check) => check.id),
    complete: pending.length === 0,
    passed:
      pending.length === 0 &&
      checks.every((check) => completed.get(check.id) === true),
  };
}
