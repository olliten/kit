import type { TestGroup } from "../primitives/default-config.js";
import type { ImportEdge } from "../primitives/import.js";

const EXTENSION = /\.[cm]?[jt]sx?$/;

// The group each test runs in, by its index among `groups`: the first whose directories hold the test and whose
// `reaching` names a module the test's imports reach, directly or through the files they import, and otherwise
// the first whose directories hold it and that names none. A module is named by its path, with or without its
// extension. A test no group takes has no entry.
export function testGroups(tests: readonly string[], groups: readonly TestGroup[], imports: readonly ImportEdge[]): ReadonlyMap<string, number> {
  const importers = new Map<string, string[]>();
  for (const { from, to } of imports) {
    const known = importers.get(to);
    if (known === undefined) importers.set(to, [from]);
    else known.push(from);
  }
  // Every file that reaches one of the modules, found backwards from them, so each group walks the graph once
  // however many tests there are.
  const reaching = groups.map((group) => {
    if (group.reaching === undefined) return undefined;
    const named = new Set(group.reaching);
    const reached = new Set<string>();
    const pending = [...new Set([...importers.keys(), ...tests])].filter((file) => named.has(file) || named.has(file.replace(EXTENSION, "")));
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (reached.has(file)) continue;
      reached.add(file);
      pending.push(...(importers.get(file) ?? []));
    }
    return reached;
  });
  const holds = (group: TestGroup, test: string): boolean => group.under.some((directory) => directory === "." || test.startsWith(`${directory}/`));
  const chosen = new Map<string, number>();
  for (const test of tests) {
    const held = groups.flatMap((group, index) => (holds(group, test) ? [index] : []));
    const index = held.find((at) => reaching[at]?.has(test) === true) ?? held.find((at) => reaching[at] === undefined);
    if (index !== undefined) chosen.set(test, index);
  }
  return chosen;
}
