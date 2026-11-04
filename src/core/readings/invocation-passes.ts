import type { InvocationEvidence } from "../primitives/invocation-evidence.js";
import type { Verdict } from "../primitives/verdict.js";
import { runtimeOf, verdictOf } from "./verdict-reuse.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A supplied invocation is authoritative for this check: foreign or malformed evidence is an error, never a
// reason to fall back to an older stored pass. Every supplied identity must name an assigned test.
export function invocationPasses(
  text: string,
  root: string,
  runtime: string,
  scripts: string,
  commands: ReadonlyMap<string, string>,
): ReadonlyMap<string, Verdict> {
  const parsed: unknown = JSON.parse(text);
  if (
    !record(parsed) || parsed["version"] !== 1 || parsed["root"] !== root ||
    parsed["runtime"] !== runtime || parsed["scripts"] !== scripts || !record(parsed["tests"]) ||
    Object.keys(parsed).some((key) => !["version", "root", "runtime", "scripts", "tests"].includes(key))
  ) throw new Error("Invocation evidence does not describe this governed root, runtime and scripts.");
  const tests = new Map<string, Verdict>();
  for (const [test, entry] of Object.entries(parsed["tests"])) {
    const command = commands.get(test);
    if (command === undefined) throw new Error(`Invocation evidence names ${test}, which no current test command takes.`);
    if (!record(entry) || entry["command"] !== command || Object.keys(entry).some((key) => !["command", "verdict"].includes(key)))
      throw new Error(`Invocation evidence for ${test} does not describe its current test command.`);
    const supplied = entry["verdict"];
    if (!record(supplied) || Object.keys(supplied).some((key) => !["check", "states", "ran", "execution"].includes(key)))
      throw new Error(`Invocation evidence for ${test} holds unsupported verdict fields.`);
    const execution = supplied["execution"];
    if (execution !== undefined && (!record(execution) || Object.keys(execution).some((key) => !["complete", "runtime", "loaded"].includes(key))))
      throw new Error(`Invocation evidence for ${test} holds unsupported execution fields.`);
    const verdict = verdictOf(JSON.stringify({ ...supplied, seconds: 0 }));
    if (verdict === null || verdict.check !== `test:${test}` ||
      (verdict.execution !== undefined && verdict.execution.runtime !== runtimeOf(command, runtime, scripts)))
      throw new Error(`Invocation evidence for ${test} is malformed or belongs to another execution context.`);
    tests.set(test, verdict);
  }
  return tests;
}

// Every offered byte is an input of post-test checks. Keep diagnostics outside this public artifact rather
// than hashing a projection of fields a consumer can still read from the actual file.
export function invocationText({ version, root, runtime, scripts, tests }: InvocationEvidence): string {
  return JSON.stringify({
    version, root, runtime, scripts,
    tests: Object.fromEntries(Object.entries(tests).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([test, { command, verdict }]) => [test, {
      command,
      verdict: {
        check: verdict.check,
        states: Object.fromEntries(Object.entries(verdict.states).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
        ...(verdict.ran === undefined ? {} : { ran: Object.fromEntries(Object.entries(verdict.ran).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([module, functions]) => [module, [...new Set(functions)].sort()])) }),
        ...(verdict.execution === undefined ? {} : { execution: {
          complete: verdict.execution.complete, runtime: verdict.execution.runtime, loaded: [...new Set(verdict.execution.loaded)].sort(),
        } }),
      },
    }])),
  });
}
