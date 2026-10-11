// The five kinds, by type signature (proposal §2), listed in their within-zone order
// data ← state ← reading ← change ← effect: a module depends only on its own kind or an earlier one.
export const KINDS = ["data", "state", "reading", "change", "effect"] as const;

export type Kind = (typeof KINDS)[number];

// The core kinds another zone may import. Core state is private (R2).
export const PUBLIC_CORE_KINDS: readonly Kind[] = ["data", "reading", "change"];
