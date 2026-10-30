import { isRecord } from "./config-values.js";

// The size limits an app opts into. A limit is a whole number of lines above zero, since zero, a fraction or a
// negative number would fail every function or none, which no app means by declaring one.
export function configuredLimits(declaration: unknown): { readonly functionLines: number } {
  const lines = isRecord(declaration) ? declaration["functionLines"] : undefined;
  if (typeof lines !== "number" || !Number.isInteger(lines) || lines < 1)
    throw new Error("Declare limits as a mapping whose functionLines is a whole number of lines above zero, such as 120.");
  return { functionLines: lines };
}
