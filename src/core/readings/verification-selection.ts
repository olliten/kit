import type { VerificationSelection } from "../primitives/selection.js";
import { isRecord, isTexts, normalizedPath, relativeLocation } from "./config-values.js";
import { digest } from "./fact-keys.js";

export const discoveryIdentity = (tests: readonly string[]): string => digest(JSON.stringify([...new Set(tests)].sort()));

// Selection narrows execution, never discovery or group validation. A caller cannot omit an unknown test
// by supplying an old discovery digest, and an omitted selection always means the complete inventory.
export function verificationSelection(input: unknown, discovered: readonly string[]): {
  readonly scope: "all" | "selected";
  readonly selected: readonly string[];
  readonly deferred: readonly string[];
  readonly discovery: string;
  readonly policy: string;
} {
  const inventory = [...new Set(discovered)].sort();
  const discovery = discoveryIdentity(inventory);
  if (input === undefined) return { scope: "all", selected: inventory, deferred: [], discovery, policy: "all/1" };
  if (!isRecord(input) || input["version"] !== 1 || input["discovery"] !== discovery || typeof input["policy"] !== "string" || !input["policy"].trim() || !isTexts(input["tests"]))
    throw new Error("selection: declare version 1, the current discovery identity, a policy and test identities.");
  if (Object.keys(input).some((key) => !["version", "discovery", "policy", "tests"].includes(key)))
    throw new Error("selection: unknown field.");
  const tests = input["tests"];
  if (new Set(tests).size !== tests.length || tests.some((test) => !relativeLocation(test) || normalizedPath(test) !== test || test.split("/").includes("..") || !inventory.includes(test)))
    throw new Error("selection: test identities must be distinct discovered paths inside the app.");
  const selection: VerificationSelection = { version: 1, discovery, policy: input["policy"], tests };
  const chosen = new Set(selection.tests);
  return { scope: "selected", selected: [...chosen].sort(), deferred: inventory.filter((test) => !chosen.has(test)), discovery, policy: selection.policy };
}

// Group classification is supplied by the same complete inventory used for ordinary verification.
export function deferredGroupSelection(
  id: string,
  discovered: readonly string[],
  groups: readonly { readonly id?: string }[],
  classified: ReadonlyMap<string, number>,
): ReturnType<typeof verificationSelection> {
  const index = groups.findIndex((group) => group.id === id);
  if (index < 0) throw new Error(`defer-group: no declared group has id ${id}.`);
  return verificationSelection({
    version: 1,
    discovery: discoveryIdentity(discovered),
    policy: `deferred-group/${encodeURIComponent(id)}/1`,
    tests: discovered.filter((test) => classified.get(test) !== index),
  }, discovered);
}
