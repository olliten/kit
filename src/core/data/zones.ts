// The three zones, by what code may do (proposal §2). The core is the inward zone.
export const ZONES = ["core", "shell", "substrate"] as const;

export type Zone = (typeof ZONES)[number];
