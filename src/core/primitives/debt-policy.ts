// Both modes forbid new debt. Paydown additionally requires a real reduction of an approved obligation
// associated with the supplied source, claim or proof-dependency paths. Kit does not infer Git history.
export type DebtMode = "ratchet" | "paydown";

export interface DebtPolicy {
  readonly mode: DebtMode;
  readonly footprint: readonly string[];
}
