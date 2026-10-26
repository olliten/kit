import { type Declaration, isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

// The directories a test runner discovers: the proof root, and only the legacy test roots an app declares.
export function testRoots(declaration: Declaration): string[] {
  const legacy = declaration["legacy-test-roots"] === undefined ? [] : declaration["legacy-test-roots"];
  if (!Array.isArray(legacy))
    throw new Error("The Kit configuration's legacy-test-roots must list relative directories.");
  const roots = isRecord(declaration["roots"]) ? declaration["roots"]["oracle"] : undefined;
  return [
    ...new Set(
      [...legacy, roots].map((root: unknown) => {
        const normalized = isText(root) ? normalizedPath(root) : "";
        if (
          !isText(root) ||
          !root ||
          root.trim() !== root ||
          !relativeLocation(root) ||
          root.split("/").some((part) => part === "." || part === "..") ||
          normalized === "."
        )
          throw new Error("Proof roots must be relative directories without patterns or dot segments.");
        return normalized;
      }),
    ),
  ];
}
