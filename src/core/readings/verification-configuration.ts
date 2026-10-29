import type { KitConfig, TestGroup } from "../primitives/default-config.js";
import { isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

// The gate an app declares under `verify`: each whole-tree check is an id and one command, run with the tests or,
// when it reads what they record, after them; the tests are one group or a list of groups, each one command that
// runs the test file `{test}`, for every test under one or more relative directories, and optionally the modules
// whose reach selects the group.
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
  if (Array.isArray(tests)) {
    if (tests.length === 0) throw new Error("verify.tests: list at least one group of tests.");
    return { checks: rows, tests: tests.map((row: unknown, index) => group(row, `verify.tests[${index}]`)) };
  }
  return { checks: rows, tests: [group(tests, "verify.tests")] };
}

// A path inside the app, named relative to its root.
const inside = (path: unknown): path is string => isText(path) && relativeLocation(path) && !normalizedPath(path).split("/").includes("..");

function group(declared: unknown, at: string): TestGroup {
  const command = isRecord(declared) ? declared["command"] : undefined;
  const declaredUnder = isRecord(declared) ? declared["under"] : undefined;
  const under = isText(declaredUnder) ? [declaredUnder] : declaredUnder;
  if (!isText(command) || !command.includes("{test}") || !Array.isArray(under) || under.length === 0 || !under.every(inside))
    throw new Error(`${at}: declare the command that runs one test file {test}, and the directories under which tests are found.`);
  const directories = [...new Set(under.filter(isText).map((path) => normalizedPath(path)))].sort();
  const reaching = isRecord(declared) ? declared["reaching"] : undefined;
  if (reaching === undefined) return { command, under: directories };
  if (!Array.isArray(reaching) || reaching.length === 0 || !reaching.every(inside))
    throw new Error(`${at}.reaching: list the modules inside the app, each by its relative path, whose reach selects this group.`);
  return { command, under: directories, reaching: [...new Set(reaching.filter(isText).map((path) => normalizedPath(path)))].sort() };
}
