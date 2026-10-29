import type { KitConfig } from "../primitives/default-config.js";
import { isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

// The gate an app declares under `verify`: each whole-tree check is an id and one command, run with the tests or,
// when it reads what they record, after them; the tests are one command that runs the test file `{test}`, for
// every test under a relative directory.
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
  const tests = declared["tests"];
  if (tests === undefined) return { checks: rows };
  const command = isRecord(tests) ? tests["command"] : undefined;
  const under = isRecord(tests) ? tests["under"] : undefined;
  if (
    !isText(command) ||
    !command.includes("{test}") ||
    !isText(under) ||
    !relativeLocation(under) ||
    normalizedPath(under).split("/").includes("..")
  )
    throw new Error("verify.tests: declare the command that runs one test file {test}, and the directory under which tests are found.");
  return { checks: rows, tests: { command, under: normalizedPath(under) } };
}
