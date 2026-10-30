import type { KitConfig, RunRule } from "../primitives/default-config.js";
import { isRecord, isText } from "./config-values.js";

const RUN_RULES: readonly RunRule[] = ["ungoverned-function", "excerpt-cohesion"];

// The rules an app switches off. A rule is switched off only by declaration, with the reason it is off, so the
// architecture changes deliberately; which names and keys may be declared, the schema of the config already holds.
export function configuredRules(declared: unknown): NonNullable<KitConfig["rules"]> {
  if (!isRecord(declared))
    throw new Error("rules: declare each rule switched off by its name, mapped to off and the reason, such as excerpt-cohesion: {off: <reason>}.");
  const rules: { [rule in RunRule]?: { readonly off: string } } = {};
  for (const rule of RUN_RULES) {
    const value = declared[rule];
    if (value === undefined) continue;
    const off = isRecord(value) ? value["off"] : undefined;
    if (!isText(off) || !off.trim()) throw new Error(`rules.${rule}.off: declare the reason the rule is switched off, as nonempty text.`);
    rules[rule] = { off };
  }
  return rules;
}

// The rules that read what tests ran and are not switched off: those that report what tests ran, and whose
// baseline keys wait with them while a test has no kept pass.
export function engagedRules(config: KitConfig): RunRule[] {
  return RUN_RULES.filter((rule) => config.rules?.[rule] === undefined);
}
