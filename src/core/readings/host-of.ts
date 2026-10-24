import type { Host, KitConfig } from "../primitives/default-config.js";
import type { Zone } from "../primitives/zones.js";

export interface ResolvedHost {
  readonly name: string;
  readonly lib: readonly string[];
  readonly zone: "shell" | "substrate" | null;
  readonly entries: readonly string[];
  readonly roots: readonly string[];
  readonly provides: readonly { readonly name: string; readonly exports: readonly string[] }[];
  readonly enteredBy: readonly { readonly name: string; readonly type: string }[];
}

export interface HostModel {
  readonly hosts: readonly ResolvedHost[];
  // The configuration keys read in place of hosts, each reported once so the app can migrate.
  readonly deprecated: readonly string[];
}

// The host claim tests run in, whatever else an app declares.
export const PROOF_HOST = "proof";

// An app without hosts keeps what its zones always meant: Shell runs where the DOM exists, Substrate where
// Node and the shared web platform do, and its proofs where either may.
const DERIVED: Readonly<Record<string, Host>> = {
  browser: { lib: ["dom"], zone: "shell" },
  server: { lib: ["node", "webworker"], zone: "substrate" },
  [PROOF_HOST]: { lib: ["dom", "node"] },
};
// Where an old startup exception outside the proof root keeps running: it wired both outer zones.
const STARTUP_HOST = "startup";

export function hostOf(config: KitConfig): HostModel {
  const declared = config.hosts;
  const deprecated: string[] = [];
  const hosts = new Map<string, ResolvedHost>(
    Object.entries(declared ?? DERIVED).map(([name, host]) => {
      return [
        name,
        {
          name,
          lib: [...host.lib],
          zone: host.zone ?? null,
          entries: [...(host.entries ?? [])],
          roots: (host.roots ?? []).map((root) => root.replace(/\/$/, "")),
          provides: Object.entries(host.provides ?? {}).map(([name, exports]) => ({ name, exports: [...exports] })),
          enteredBy: (host.enteredBy ?? []).map((reference) => {
            const at = reference.lastIndexOf("#");
            return { name: reference.slice(0, at), type: reference.slice(at + 1) };
          }),
        },
      ];
    }),
  );
  const existing = (name: string): ResolvedHost =>
    hosts.get(name) ?? {
      name,
      lib: name === STARTUP_HOST ? ["dom", "node", "webworker"] : [...(DERIVED[PROOF_HOST]?.lib ?? [])],
      zone: null,
      entries: [],
      roots: [],
      provides: [],
      enteredBy: [],
    };
  const exceptions = config.exceptions ?? [];
  if (exceptions.length > 0) deprecated.push("exceptions");
  for (const path of exceptions) {
    const host = existing(path.startsWith(`${config.oracleRoot}/`) ? PROOF_HOST : STARTUP_HOST);
    hosts.set(host.name, { ...host, entries: [...host.entries, path] });
  }
  const legacyTestRoots = config.legacyTestRoots ?? [];
  if (legacyTestRoots.length > 0) {
    deprecated.push("legacy-test-roots");
    const host = existing(PROOF_HOST);
    hosts.set(PROOF_HOST, {
      ...host,
      roots: [...new Set([...host.roots, ...legacyTestRoots.map((root) => root.replace(/\/$/, ""))])],
    });
  }
  const provided = (config.packages ?? []).filter((row) => row.entrypointExports !== undefined);
  if (provided.length > 0) deprecated.push("entrypointExports");
  for (const row of provided)
    for (const name of hosts.has(STARTUP_HOST) ? [PROOF_HOST, STARTUP_HOST] : [PROOF_HOST]) {
      const host = existing(name);
      hosts.set(name, {
        ...host,
        provides: [...host.provides, { name: row.name, exports: [...(row.entrypointExports ?? [])] }],
      });
    }
  return { hosts: [...hosts.values()], deprecated };
}

// Every entry a host lists; claim tests are entries too, but only listed ones are compiled and checked.
export function listedEntries(model: HostModel): readonly string[] {
  return [...new Set(model.hosts.flatMap((host) => host.entries))];
}

// The host a file runs in: the host listing it as an entry, the proof host for its tests and for the shared
// proof code beside them, else its zone's host. The core runs in none.
export function hostOfFile(
  model: HostModel,
  config: KitConfig,
  path: string,
  zone: Zone | undefined,
  test: boolean,
): ResolvedHost | undefined {
  const entry = model.hosts.find((host) => host.entries.includes(path));
  if (entry !== undefined) return entry;
  if (zone === "core") return undefined;
  const proof = model.hosts.find((host) => host.name === PROOF_HOST);
  const under = (root: string): boolean => path.startsWith(`${root}/`);
  if (proof !== undefined && (under(config.oracleRoot) || (test && proof.roots.some(under)))) return proof;
  return zone === undefined ? undefined : model.hosts.find((host) => host.zone === zone);
}
