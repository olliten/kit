import type { KitConfig } from "../primitives/default-config.js";

// The values a Kit configuration declares, checked as they are read: mappings, text, lists of text, zones and
// relative locations.
export type Declaration = { readonly [key: string]: unknown };
type Zone = NonNullable<KitConfig["legacyZones"]>[number]["zone"];

export const isRecord = (value: unknown): value is Declaration =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isText = (value: unknown): value is string => typeof value === "string";
export const isTexts = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isText);
export const isZone = (value: unknown): value is Zone => value === "core" || value === "shell" || value === "substrate";
export const texts = (value: unknown, what: string): readonly string[] => {
  if (value === undefined) return [];
  if (!isTexts(value)) throw new Error(`The Kit configuration's ${what} must list text entries.`);
  return value;
};

// The posix form of a relative or absolute path, with `.` and `..` resolved as far as the path allows.
export function normalizedPath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else if (part !== ".." || !absolute) parts.push(part);
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined || ".";
}

// A declared location is relative, inside the app, and names no pattern, so the walk can match it by prefix.
export const relativeLocation = (path: string): boolean =>
  !path.includes("\\") && !/^[a-z]:/i.test(path) && !/[*?{}[\]!]/.test(path) && !path.startsWith("/");

