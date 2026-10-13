export const LAYERS = ["primitives", "readings", "adapters", "compositions"] as const;
export type Layer = (typeof LAYERS)[number];
