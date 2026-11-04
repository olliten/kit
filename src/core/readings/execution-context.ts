import type { ExecutionContext } from "../primitives/runs.js";
import { fileURLToPath } from "node:url";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sourcePath = (path: string): boolean =>
  path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").some((part) => part === ".." || part === "." || part === "");

const executable = (path: string): boolean => /\.[cm]?[jt]sx?$/.test(path) && !path.split("/").includes("node_modules");

// A context supplied by a recorder must describe original sources inside the governed root. Unknown contexts
// remain unqualified rather than being guessed from coverage, which lists only code that happened to run.
export function executionContextOf(value: unknown): ExecutionContext | undefined {
  if (!record(value) || typeof value["complete"] !== "boolean" || typeof value["runtime"] !== "string" || !value["runtime"])
    return undefined;
  const loaded = value["loaded"];
  if (!Array.isArray(loaded) || !loaded.every((path: unknown) => typeof path === "string" && sourcePath(path))) return undefined;
  return { complete: value["complete"], loaded: [...new Set<string>(loaded)].sort(), runtime: value["runtime"] };
}

// Attributable Node loads and complete supplemental runtime captures form one proof's context. Shared runner
// coverage belongs to no individual proof and must not be passed here. Browser capture supplies original-source
// context separately; an LCOV report alone cannot establish everything a page loaded.
export function executionContext(
  uses: ReadonlyMap<string, ReadonlySet<string>>,
  v8: readonly string[],
  root: string,
  runtime: string,
  supplemental: readonly ExecutionContext[] = [],
): ExecutionContext {
  const loaded = new Set<string>();
  let complete = v8.length > 0 || supplemental.length > 0;
  const mapped = new Map<string, readonly string[]>();
  for (const [path, kinds] of uses)
    for (const kind of kinds)
      if (kind.startsWith("source:")) {
        try {
          const paths: unknown = JSON.parse(decodeURIComponent(kind.slice(7)));
          if (!Array.isArray(paths) || paths.length === 0 || !paths.every((path: unknown) => typeof path === "string" && sourcePath(path))) complete = false;
          else if (mapped.has(path) && JSON.stringify(mapped.get(path)) !== JSON.stringify(paths)) complete = false;
          else mapped.set(path, paths);
        } catch {
          complete = false;
        }
      }
  const add = (path: string): void => {
    if (!sourcePath(path)) {
      complete = false;
      return;
    }
    for (const original of mapped.get(path) ?? [path]) if (executable(original)) loaded.add(original);
  };
  for (const [path, kinds] of uses)
    if (kinds.has("load")) add(path);
  for (const text of v8) {
    let report: unknown;
    try {
      report = JSON.parse(text);
    } catch {
      complete = false;
      continue;
    }
    if (!record(report) || !Array.isArray(report["result"])) {
      complete = false;
      continue;
    }
    for (const script of report["result"]) {
      if (!record(script) || typeof script["url"] !== "string") {
        complete = false;
        continue;
      }
      const url = script["url"];
      if (url.startsWith("file://")) {
        try {
          const absolute = fileURLToPath(url);
          if (absolute.startsWith(`${root}/`)) {
            add(absolute.slice(root.length + 1));
          }
        } catch {
          complete = false;
        }
      } else if (!url.startsWith("node:")) complete = false;
    }
  }
  for (const context of supplemental) {
    const valid = executionContextOf(context);
    if (valid === undefined || !valid.complete || valid.runtime !== runtime) complete = false;
    for (const path of valid?.loaded ?? []) if (!path.split("/").includes("node_modules")) loaded.add(path);
  }
  return { complete, loaded: [...loaded].sort(), runtime };
}
