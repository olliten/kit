import { isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

// The refinement constructors an app registers. Each row names a relative module and the export that constructs
// its branded result; a row repeating an earlier one is an error, since it would register nothing new.
export function configuredRefinements(declared: unknown): readonly { readonly module: string; readonly export: string }[] {
  if (!Array.isArray(declared))
    throw new Error("Declare refinements as a list of rows, each with the module and the export that constructs a branded type.");
  const seen = new Set<string>();
  return declared.map((row: unknown, index) => {
    const module = isRecord(row) ? row["module"] : undefined;
    const name = isRecord(row) ? row["export"] : undefined;
    if (!isText(module) || !relativeLocation(module) || !isText(name) || name === "")
      throw new Error(`refinements[${index}] must name a relative module and an export, such as module: src/core/primitives/row-id.ts and export: rowIdOf.`);
    const path = normalizedPath(module);
    if (seen.has(`${path}#${name}`)) throw new Error(`refinements[${index}] repeats the registration of ${name} in ${path}.`);
    seen.add(`${path}#${name}`);
    return { module: path, export: name };
  });
}
