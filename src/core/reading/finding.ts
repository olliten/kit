// The finding format (proposal §8): the rule it serves, the artifact path, the named fix, and a stable
// debt key a debt list can hold.
export type Rule = "R1" | "R2" | "R3" | "R4";

export interface Finding {
  readonly rule: Rule;
  readonly path: string;
  readonly fix: string;
  readonly debtKey: string;
}

// `check` names the check within the rule; `detail` tells apart several findings of one check on one
// path. The debt key is stable while those are.
export function finding(
  rule: Rule,
  check: string,
  path: string,
  fix: string,
  detail?: string,
): Finding {
  const debtKey = `${rule}:${check}:${path}${detail === undefined ? "" : `:${detail}`}`;
  return { rule, path, fix, debtKey };
}

export function byDebtKey(a: Finding, b: Finding): number {
  return a.debtKey < b.debtKey ? -1 : a.debtKey > b.debtKey ? 1 : 0;
}
