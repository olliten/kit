import type { KitConfig } from "../primitives/default-config.js";
import { isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

// The gate an app declares under `verify`: each whole-tree check is an id and one command, run with the tests or,
// when it reads what they record, after them; the tests are one command that runs the test file `{test}`, for
// every test under one or more relative directories; `share` is the ref prefix on `origin` passes are shared under.
export function verification(declared: unknown): NonNullable<KitConfig["verify"]> {
  if (!isRecord(declared)) throw new Error("verify: declare the gate's checks and, optionally, its tests.");
  const checks = declared["checks"] ?? [];
  if (!Array.isArray(checks)) throw new Error("verify.checks: list each check's id and command.");
  const seen = new Set<string>();
  const rows = checks.map((row: unknown, index) => {
    const id = isRecord(row) ? row["id"] : undefined;
    const command = isRecord(row) ? row["command"] : undefined;
    const after = isRecord(row) ? row["after"] : undefined;
    if (!isText(id) || !id.trim() || id.startsWith("test:") || !isText(command) || !command.trim() || (after !== undefined && after !== "tests"))
      throw new Error(`verify.checks[${index}]: a check declares an id, not starting test:, a command, and optionally after: tests.`);
    if (seen.has(id)) throw new Error(`verify.checks[${index}]: ${id} is declared twice.`);
    seen.add(id);
    return after === "tests" ? { id, command, after: "tests" as const } : { id, command };
  });
  // A ref prefix git accepts on every platform: components of plain characters, none hidden or a lock.
  const share = declared["share"];
  const shareRef = isText(share) ? share.replace(/\/+$/, "") : undefined;
  if (
    share !== undefined &&
    (shareRef === undefined ||
      !/^refs(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)+$/.test(shareRef) ||
      shareRef.split("/").some((part) => part.endsWith(".lock") || part.endsWith(".") || part.includes("..")))
  )
    throw new Error("verify.share: declare the ref prefix on origin passes are shared under, such as refs/heads/kit-passes.");
  const shared = shareRef === undefined ? {} : { share: shareRef };
  const tests = declared["tests"];
  if (tests === undefined) return { checks: rows, ...shared };
  const command = isRecord(tests) ? tests["command"] : undefined;
  const declaredUnder = isRecord(tests) ? tests["under"] : undefined;
  const under = isText(declaredUnder) ? [declaredUnder] : declaredUnder;
  if (
    !isText(command) ||
    !command.includes("{test}") ||
    !Array.isArray(under) ||
    under.length === 0 ||
    !under.every((path: unknown) => isText(path) && relativeLocation(path) && !normalizedPath(path).split("/").includes(".."))
  )
    throw new Error("verify.tests: declare the command that runs one test file {test}, and the directories under which tests are found.");
  return { checks: rows, tests: { command, under: [...new Set(under.filter(isText).map((path) => normalizedPath(path)))].sort() }, ...shared };
}
