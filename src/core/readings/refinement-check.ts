import type { Snapshot } from "../primitives/snapshot.js";
import { type CapabilityContext, type CapabilityFinding, capabilityFinding } from "./capability-context.js";

// The type assertions registered refinement constructors may hold, each by its file and site, and a finding for
// each registration that is not a constructor of a branded result whose assertion is reached only past a runtime
// check and which a test calls directly. An assertion keeps its escape unless every part holds.
export function refinementCheck(
  snapshot: Snapshot,
  context: CapabilityContext,
): { readonly allowed: ReadonlySet<string>; readonly findings: readonly CapabilityFinding[] } {
  const allowed = new Set<string>();
  const findings: CapabilityFinding[] = [];
  const projects = snapshot.compiler?.projects ?? [];
  for (const { module, export: name } of snapshot.config.refinements ?? []) {
    const fail = (check: string, fix: string): void => {
      findings.push(capabilityFinding(snapshot, context.startups, "R1", check, module, fix, name));
    };
    const assertions = projects.flatMap((project) =>
      project.escapes.filter((escape) => escape.kind === "assertion" && escape.file === module && escape.holder === name),
    );
    const tested = projects.some((project) =>
      (project.proofs ?? []).some((proof) =>
        (proof.declarations ?? []).some((declaration) => declaration.file === module && declaration.name === name),
      ),
    );
    if (assertions.length === 0)
      fail("refinement-assertion", `Assert ${name}'s branded result in ${name}, or remove its refinement registration.`);
    if (assertions.some((escape) => escape.brand === undefined))
      fail("refinement-brand", `Declare ${name}'s result as a branded type and assert exactly that result.`);
    if (assertions.some((escape) => escape.checked !== true))
      fail("refinement-unchecked", `Check the value at runtime before ${name} asserts it, rejecting other values by throwing or returning.`);
    if (!tested) fail("refinement-untested", `Call ${name} directly from a test.`);
    if (tested)
      for (const escape of assertions)
        if (escape.brand !== undefined && escape.checked === true) allowed.add(`${escape.file}#${escape.site ?? escape.start}`);
  }
  return { allowed, findings };
}
