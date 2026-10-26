import type { Snapshot } from "../primitives/snapshot.js";
import {
  type AuthorityPart,
  type CapabilityContext,
  type CapabilityFinding,
  HOST_LIBRARY,
  capabilityFinding,
  capabilityLimit,
  nativeKey,
} from "./capability-context.js";

// What a module acquires through ambient globals: an installed package's global, such as Node's process,
// reaches the host without an import, so only an adapter declaring it may use it; a declared global grants its
// adapter's capability, and outside that adapter it is a raw use.
export function globalAuthority(snapshot: Snapshot, context: CapabilityContext): AuthorityPart {
  const checked = new Set(context.files);
  const registered = context.adapters.map(({ adapter }) => adapter);
  const externalAdapterPaths = new Set(
    context.adapters.filter(({ adapter }) => adapter.kind === "external").map(({ path }) => path),
  );
  const grants: { file: string; capability: string }[] = [];
  const natives: { file: string; key: string }[] = [];
  const globalWindow: string[] = [];
  const rawFailures: string[] = [];
  const findings: CapabilityFinding[] = [];
  for (const project of snapshot.compiler?.projects ?? []) {
    const hostGlobals = new Set<string>();
    for (const global of project.globals) {
      if (!global.runtime || !checked.has(global.file)) continue;
      const name = global.name.startsWith("globalThis.") ? global.name.slice("globalThis.".length) : global.name;
      const declared = global.declarationFile ?? "";
      if (
        !name.includes(".") &&
        global.value !== true &&
        /(?:^|\/)node_modules\//.test(declared) &&
        !/(?:^|\/)node_modules\/typescript\/lib\//.test(declared) &&
        !registered.some((adapter) => adapter.globals?.includes(name)) &&
        !hostGlobals.has(`${global.file}:${name}`)
      ) {
        hostGlobals.add(`${global.file}:${name}`);
        findings.push(
          capabilityLimit(
            "ambient-global",
            global.file,
            "This ambient global from an installed package has no declared capability adapter.",
            name,
          ),
        );
      }
      const declaredAdapters = context.adapters.filter(({ adapter }) => adapter.globals?.includes(global.name));
      const owners = declaredAdapters.filter(({ path }) => path === global.file);
      if (externalAdapterPaths.has(global.file) || declaredAdapters.length === 0)
        for (const authority of global.nativeAuthority ?? []) {
          natives.push({ file: global.file, key: nativeKey(authority.root) });
          if (HOST_LIBRARY.test(authority.root.file) && authority.root.name === "Window")
            globalWindow.push(`${global.file}:${nativeKey(authority.root)}`);
        }
      for (const { adapter, path } of owners.length > 0 ? owners : declaredAdapters) {
        grants.push({ file: global.file, capability: adapter.capability });
        if (global.file !== path) {
          rawFailures.push(`${global.file}:${adapter.capability}`);
          findings.push(
            capabilityFinding(
              snapshot,
              context.startups,
              "R1",
              "raw-primitive",
              global.file,
              "Acquire this ambient authority only through its declared capability adapter.",
              adapter.capability,
            ),
          );
        }
      }
    }
  }
  return { grants, natives, globalWindow, rawFailures, findings };
}
