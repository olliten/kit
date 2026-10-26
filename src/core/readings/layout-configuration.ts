import { isRecord, isText, relativeLocation } from "./config-values.js";

// The layout an app opts into: existing legacy locations, each a relative file or directory without patterns.
export function configuredLayout(declaration: unknown): { readonly legacy: readonly string[] } {
  const legacy = isRecord(declaration) ? declaration["legacy"] : undefined;
  if (!isRecord(declaration) || Object.keys(declaration).some((key) => key !== "legacy") || !Array.isArray(legacy))
    throw new Error("Declare layout as a mapping with a legacy list of relative files or directories.");
  const locations = legacy.map((path: unknown) => {
    if (
      !isText(path) ||
      !path ||
      path.trim() !== path ||
      !relativeLocation(path) ||
      path.replace(/\/$/, "").split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Layout legacy locations must be relative files or directories without patterns or dot segments.");
    return path.replace(/\/$/, "");
  });
  return { legacy: [...new Set(locations)].sort() };
}
