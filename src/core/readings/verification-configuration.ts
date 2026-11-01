import type { KitConfig, TestGroup } from "../primitives/default-config.js";
import { isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

// The gate an app declares under `verify`: each whole-tree check is an id and one command, run with the tests or,
// when it reads what they record, after them; the tests are one group or a list of groups, each one command that
// runs the test file `{test}`, or several test files `{tests}` with Kit's coverage provider `{provider}` writing
// into `{dir}`, for every test under one or more relative directories, and optionally the modules, and the
// capabilities of the adapters among `registered`, whose reach selects the group; `share` is the ref prefix on
// `origin` passes are shared under. A check may name the checks it `needs` to have passed first, and `capacity`,
// for the gate and for a group, is how much runs at once.
export function verification(declared: unknown, registered: readonly string[]): NonNullable<KitConfig["verify"]> {
  if (!isRecord(declared)) throw new Error("verify: declare the gate's checks and, optionally, its tests.");
  const checks = declared["checks"] ?? [];
  if (!Array.isArray(checks)) throw new Error("verify.checks: list each check's id and command.");
  const seen = new Set<string>();
  const rows = checks.map((row: unknown, index) => {
    const id = isRecord(row) ? row["id"] : undefined;
    const command = isRecord(row) ? row["command"] : undefined;
    const after = isRecord(row) ? row["after"] : undefined;
    const needs = isRecord(row) ? row["needs"] : undefined;
    if (!isText(id) || !id.trim() || id.startsWith("test:") || !isText(command) || !command.trim() || (after !== undefined && after !== "tests"))
      throw new Error(`verify.checks[${index}]: a check declares an id, not starting test:, a command, and optionally after: tests.`);
    if (seen.has(id)) throw new Error(`verify.checks[${index}]: ${id} is declared twice.`);
    if (needs !== undefined && (!Array.isArray(needs) || !needs.every((need) => isText(need) && need.trim() !== "")))
      throw new Error(`verify.checks[${index}].needs: list the ids of the checks ${id} needs to have passed first.`);
    seen.add(id);
    const needed = Array.isArray(needs) ? { needs: [...new Set(needs.filter(isText))] } : {};
    return after === "tests" ? { id, command, after: "tests" as const, ...needed } : { id, command, ...needed };
  });
  needsHold(rows);
  // A ref prefix git accepts on every platform: components of plain characters, none hidden or a lock.
  const share = declared["share"];
  const shareRef = isText(share) ? share.replace(/\/+$/, "") : undefined;
  if (
    share !== undefined &&
    (shareRef === undefined ||
      !/^refs(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)+$/.test(shareRef) ||
      shareRef.split("/").some((part) => part.endsWith(".lock") || part.endsWith(".") || part.includes("..")))
  )
    throw new Error("verify.share: declare the ref prefix on origin passes are shared under, such as refs/kit-passes, outside refs/heads/ so it is no branch.");
  const capacity = declared["capacity"];
  const shared = { ...(shareRef === undefined ? {} : { share: shareRef }), ...(capacity === undefined ? {} : { capacity: counted(capacity, "verify.capacity") }) };
  const tests = declared["tests"];
  if (tests === undefined) return { checks: rows, ...shared };
  if (Array.isArray(tests)) {
    if (tests.length === 0) throw new Error("verify.tests: list at least one group of tests.");
    return { checks: rows, tests: tests.map((row: unknown, index) => group(row, `verify.tests[${index}]`, registered)), ...shared };
  }
  return { checks: rows, tests: [group(tests, "verify.tests", registered)], ...shared };
}

// A capacity: a positive whole number.
function counted(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${at}: declare how many run at once, a positive whole number.`);
  return value;
}

// Each need is a declared check, one run with the tests needs none run after them, and no check needs itself
// through others.
function needsHold(rows: readonly { readonly id: string; readonly after?: "tests"; readonly needs?: readonly string[] }[]): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  rows.forEach((row, index) => {
    for (const need of row.needs ?? []) {
      const needed = byId.get(need);
      if (needed === undefined) throw new Error(`verify.checks[${index}].needs: no check is declared as ${need}.`);
      if (row.after === undefined && needed.after === "tests")
        throw new Error(`verify.checks[${index}].needs: ${row.id} runs with the tests, so it can't need ${need}, which runs after them.`);
    }
  });
  const done = new Set<string>();
  const visit = (id: string, path: readonly string[]): void => {
    if (path.includes(id)) throw new Error(`verify.checks: the needs of ${[...path.slice(path.indexOf(id)), id].join(" -> ")} form a cycle.`);
    if (done.has(id)) return;
    for (const need of byId.get(id)?.needs ?? []) visit(need, [...path, id]);
    done.add(id);
  };
  for (const row of rows) visit(row.id, []);
}

// A path inside the app, named relative to its root.
const inside = (path: unknown): path is string => isText(path) && relativeLocation(path) && !normalizedPath(path).split("/").includes("..");

function group(declared: unknown, at: string, registered: readonly string[]): TestGroup {
  const command = isRecord(declared) ? declared["command"] : undefined;
  const declaredUnder = isRecord(declared) ? declared["under"] : undefined;
  const under = isText(declaredUnder) ? [declaredUnder] : declaredUnder;
  if (!isText(command) || !Array.isArray(under) || under.length === 0 || !under.every(inside) || command.includes("{test}") === command.includes("{tests}"))
    throw new Error(`${at}: declare the command that runs one test file {test}, or several {tests}, and the directories under which tests are found.`);
  if (command.includes("{tests}") && !(command.includes("{dir}") && command.includes("{provider}")))
    throw new Error(`${at}: a command running several test files {tests} names Kit's coverage provider {provider} writing into {dir}.`);
  const directories = [...new Set(under.filter(isText).map((path) => normalizedPath(path)))].sort();
  const reaching = isRecord(declared) ? declared["reaching"] : undefined;
  if (reaching !== undefined && (!Array.isArray(reaching) || reaching.length === 0 || !reaching.every(inside)))
    throw new Error(`${at}.reaching: list the modules inside the app, each by its relative path, whose reach selects this group.`);
  const capabilities = isRecord(declared) ? declared["capabilities"] : undefined;
  if (capabilities !== undefined && (!Array.isArray(capabilities) || capabilities.length === 0 || !capabilities.every((name) => isText(name) && name.trim() !== "")))
    throw new Error(`${at}.capabilities: list the capabilities of registered adapters whose modules' reach selects this group.`);
  const named = Array.isArray(capabilities) ? capabilities.filter(isText) : [];
  const unknown = named.findIndex((name) => !registered.includes(name));
  if (unknown >= 0)
    throw new Error(`${at}.capabilities[${unknown}]: no adapter registers the capability ${named[unknown] ?? ""}; register one under adapters, or name a registered one.`);
  const capacity = isRecord(declared) ? declared["capacity"] : undefined;
  return {
    command,
    under: directories,
    ...(capacity === undefined ? {} : { capacity: counted(capacity, `${at}.capacity`) }),
    ...(Array.isArray(reaching) ? { reaching: [...new Set(reaching.filter(isText).map((path) => normalizedPath(path)))].sort() } : {}),
    ...(named.length > 0 ? { capabilities: [...new Set(named)].sort() } : {}),
  };
}

// The command line a test's pass is kept under: its group's command for that test file alone, whether it runs
// alone or among others.
export const testLine = (command: string, test: string): string => command.replaceAll("{tests}", test).replaceAll("{test}", test);
