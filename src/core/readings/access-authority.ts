import type { Snapshot } from "../primitives/snapshot.js";
import {
  type AuthorityPart,
  type CapabilityContext,
  type CapabilityFinding,
  capabilityFinding,
  capabilityLimit,
  nativeKey,
} from "./capability-context.js";

// What a module's own member accesses acquire: the native roots it reaches, and a clock or randomness sample,
// which only the adapter declaring that primitive may take. Dynamic code has no authority identity.
export function accessAuthority(snapshot: Snapshot, context: CapabilityContext): AuthorityPart {
  const checked = new Set(context.files);
  const grants: { file: string; capability: string }[] = [];
  const natives: { file: string; key: string }[] = [];
  const rawFailures: string[] = [];
  const findings: CapabilityFinding[] = [];
  for (const access of (snapshot.compiler?.projects ?? []).flatMap((project) => project.accesses)) {
    if (!checked.has(access.file)) continue;
    if (access.kind === "native") {
      for (const authority of access.nativeAuthority ?? []) natives.push({ file: access.file, key: nativeKey(authority.root) });
      if ((access.nativeAuthority ?? []).length === 0)
        findings.push(
          capabilityLimit(
            "native-authority",
            access.file,
            "The native executable member has no supported receiver identity.",
            access.site ?? `${access.start}`,
          ),
        );
    } else if (access.kind === "clock" || access.kind === "randomness") {
      const kind = access.kind;
      const owned = context.adapters.some(
        ({ adapter, path }) => adapter.kind === "external" && path === access.file && adapter.primitives?.includes(kind),
      );
      if (!owned) {
        grants.push({ file: access.file, capability: kind });
        rawFailures.push(`${access.file}:${kind}`);
        findings.push(
          capabilityFinding(
            snapshot,
            context.startups,
            "R1",
            "raw-primitive",
            access.file,
            "Sample this operation only in its declared capability adapter.",
            kind,
          ),
        );
      }
    } else if (access.kind === "dynamic")
      findings.push(
        capabilityLimit(
          "authority-entry",
          access.file,
          "Dynamic code or ambient access has no supported authority identity.",
          `${access.kind}:${access.site ?? access.start}`,
        ),
      );
  }
  return { grants, natives, globalWindow: [], rawFailures, findings };
}
