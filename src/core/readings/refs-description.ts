import type { KitConfig } from "../primitives/default-config.js";
import { claimInventory } from "./claim-inventory.js";
import { claimsKeptBy } from "./module-references.js";
import { placementOf } from "./placement-of.js";

export interface KeptClaim {
  readonly file: string;
  readonly anchor: string;
  readonly text: string;
  readonly tests: readonly string[];
  readonly implementation?: readonly string[];
  readonly proof?: readonly string[];
}

// The text of the list item whose anchor sits on `line`.
function claimText(lines: readonly string[], line: number): string {
  let start = line - 1;
  while (start > 0 && !/^\s*- /.test(lines[start] ?? "")) start--;
  return lines
    .slice(start, line)
    .map((text) => text.trim())
    .join(" ")
    .replace(/^- /, "")
    .replace(/\s*·?\s*\{#[\w-]+\}\s*$/, "");
}

// The claims that name a module, from the topics' text and each topic's test files. A module's claims are
// derived from the claims that name it rather than written into the module, where they would go stale and make
// parallel edits collide. A path outside the placed layout keeps no claims.
export function moduleRefs(
  config: KitConfig,
  target: string,
  topics: readonly { readonly file: string; readonly text: string }[],
  tests: Readonly<Record<string, readonly string[]>>,
): { readonly module: string; readonly claims: readonly KeptClaim[] } | null {
  const isPath = target.includes("/") || /\.\w+$/.test(target);
  const at = placementOf(target, config.srcRoot);
  if (isPath && !at.placed) return null;
  const module = at.placed ? at.artifact : target;
  const name = module.split("/").at(-1) ?? "";
  const claims = topics
    .filter(({ file }) => file !== config.termsFile)
    .flatMap(({ file, text }) =>
      claimInventory(text, {
        anchor: config.anchor,
        legacy: (config.legacyAreas ?? []).includes(file),
        ...(config.claimSeparator === undefined ? {} : { separator: config.claimSeparator }),
      }).declarations.map((claim) => ({ ...claim, file })),
    );
  const kept = claimsKeptBy({ claims });
  const named = [name, ...config.plurals.filter((suffix) => name.endsWith(suffix)).map((suffix) => name.slice(0, -suffix.length))];
  const lines = new Map(topics.map(({ file, text }) => [file, text.split("\n")]));
  return {
    module,
    claims: named.flatMap((term) => kept.get(term.toLowerCase()) ?? []).map(({ file, anchor }) => {
      const topic = file.slice(config.specRoot.length + 1).replace(/\.md$/, "");
      const claim = claims.find((each) => each.file === file && each.anchor === anchor);
      return {
        file,
        anchor,
        text: claimText(lines.get(file) ?? [], claim?.line ?? 1),
        tests: (tests[topic] ?? [])
          .filter((test) => test.startsWith(`${anchor}.`) && test.endsWith(".test.ts"))
          .map((test) => `${config.oracleRoot}/${topic}/${test}`),
        ...(claim?.implementation === undefined ? {} : { implementation: claim.implementation }),
        ...(claim?.proof === undefined ? {} : { proof: claim.proof }),
      };
    }),
  };
}

export function describeRefs({ module, claims }: { readonly module: string; readonly claims: readonly KeptClaim[] }): string {
  if (claims.length === 0) return `${module} is named by no claim.`;
  return [
    `${module} keeps ${claims.length === 1 ? "1 claim" : `${claims.length} claims`}:`,
    ...claims.flatMap(({ file, anchor, text, tests, implementation, proof }) => [
      `- ${file}#${anchor}: ${text}`,
      ...(implementation === undefined
        ? []
        : [`  Implementation (${implementation.length}): ${implementation.map((term) => `{{${term}}}`).join(", ")}`]),
      ...(proof === undefined ? [] : [`  Proof (${proof.length}): ${proof.map((term) => `{{${term}}}`).join(", ")}`]),
      ...tests.map((test) => `  ${test}`),
    ]),
  ].join("\n");
}
