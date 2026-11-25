import type { BrowserMapArtifact, BrowserMapScript } from "../primitives/browser-execution.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const appPath = (path: unknown): path is string =>
  typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
  !path.split("/").some((part) => part === ".." || part === "." || part === "");

const keys = (value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

// A map artifact is the app's word for which served bytes are its code, so anything it cannot state exactly is
// no artifact: a capture given one is incomplete rather than attributed by guess.
export function browserMapOf(value: unknown): BrowserMapArtifact | undefined {
  if (!record(value) || value["version"] !== 1 || !keys(value, ["version", "scripts", "external"])) return undefined;
  const scripts = value["scripts"];
  const external = value["external"] ?? [];
  if (!Array.isArray(scripts) || !Array.isArray(external) || !external.every((prefix) => typeof prefix === "string" && prefix.length > 0))
    return undefined;
  const out: BrowserMapScript[] = [];
  const seen = new Set<string>();
  for (const script of scripts) {
    if (!record(script) || !keys(script, ["scriptHash", "base", "map"])) return undefined;
    const { scriptHash, base, map } = script;
    if (typeof scriptHash !== "string" || !/^[0-9a-f]{64}$/.test(scriptHash) || seen.has(scriptHash)) return undefined;
    if (!(base === "" || appPath(base)) || !appPath(map)) return undefined;
    seen.add(scriptHash);
    out.push({ scriptHash, base, map });
  }
  return { version: 1, scripts: out, external: [...external] };
}
