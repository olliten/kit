import type { KitConfig, RunRule, ScopedRule } from "../primitives/default-config.js";
import { isRecord, isText } from "./config-values.js";

const RUN_RULES: readonly RunRule[] = ["ungoverned-function", "excerpt-cohesion"];
const SCOPED_RULES: readonly ScopedRule[] = ["native-authority", "ambient-global"];

type Rules = { [rule in RunRule]?: { readonly off: string } } & { [rule in ScopedRule]?: { readonly tests: "off"; readonly reason: string } };

// The rules an app switches off, or scopes to production code. A rule is switched off only by declaration, with
// the reason it is off, so the architecture changes deliberately; which names and keys may be declared, the schema
// of the config already holds.
export function configuredRules(declared: unknown): NonNullable<KitConfig["rules"]> {
  if (!isRecord(declared))
    throw new Error("rules: declare each rule switched off by its name, mapped to off and the reason, such as excerpt-cohesion: {off: <reason>}.");
  const rules: Rules = {};
  for (const rule of RUN_RULES) {
    const value = declared[rule];
    if (value === undefined) continue;
    const off = isRecord(value) ? value["off"] : undefined;
    if (!isText(off) || !off.trim()) throw new Error(`rules.${rule}.off: declare the reason the rule is switched off, as nonempty text.`);
    rules[rule] = { off };
  }
  for (const rule of SCOPED_RULES) {
    const value = declared[rule];
    if (value === undefined) continue;
    const tests = isRecord(value) ? value["tests"] : undefined;
    if (tests !== "off") throw new Error(`rules.${rule}.tests: declare tests: off to scope the rule to production code.`);
    const reason = isRecord(value) ? value["reason"] : undefined;
    if (!isText(reason) || !reason.trim()) throw new Error(`rules.${rule}.reason: declare the reason the rule is off on tests, as nonempty text.`);
    rules[rule] = { tests, reason };
  }
  return rules;
}

// The rules that read what tests ran and are not switched off: those that report what tests ran, and whose
// baseline keys wait with them while a test has no kept pass.
export function engagedRules(config: KitConfig): RunRule[] {
  return RUN_RULES.filter((rule) => config.rules?.[rule] === undefined);
}

// The findings a rule scoped to production code keeps: none on a test file, and every one elsewhere.
export function scopedFindings<T extends { readonly debtKey: string; readonly path: string }>(
  findings: readonly T[],
  config: KitConfig,
  tests: ReadonlySet<string>,
): T[] {
  const scoped = SCOPED_RULES.filter((rule) => config.rules?.[rule] !== undefined).map((rule) => `R1:${rule}:`);
  if (scoped.length === 0) return [...findings];
  return findings.filter((item) => !(tests.has(item.path) && scoped.some((prefix) => item.debtKey.startsWith(prefix))));
}
