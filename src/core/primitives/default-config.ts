// The config an app declares; every root is relative to the app root the snapshot was read from.
export interface KitConfig {
  readonly srcRoot: string | readonly string[];
  readonly oracleRoot: string;
  readonly specRoot: string;
  // Opt in to directory roles; these existing locations remain checked legacy code, never extra module roots.
  readonly layout?: { readonly legacy: readonly string[] };
  // The app's language: one `- **term** — meaning` line per domain term (R3, names).
  readonly termsFile: string;
  // The small words a name may carry without a term line (R3, names).
  readonly connectors: readonly string[];
  // The suffixes that make a term's plural, which matches as the term itself (R3, names).
  readonly plurals: readonly string[];
  // How the spec marks a claim anchor, as a regular expression (R3, comments).
  readonly anchor: string;
  readonly claimSeparator?: string;
  readonly legacyAreas?: readonly string[];
  // A prefix row zones every legacy file under its root; a files row zones exactly the files it lists, each
  // recorded as debt, so the row can only shrink.
  readonly legacyZones?: readonly (
    | { readonly root: string; readonly zone: "core" | "shell" | "substrate" }
    | { readonly files: readonly string[]; readonly zone: "core" | "shell" | "substrate" }
  )[];
  // Where code runs and what may run there. Each host names the compiler libraries whose globals exist in
  // it, the zone that runs in it, its exact entry files, the proof directories its tests come from, the
  // runner exports its entries may use and the types whose function values carry code into it.
  readonly hosts?: Readonly<Record<string, Host>>;
  // Read for one release in place of hosts: exact entries, proof discovery directories and runner exports.
  readonly exceptions?: readonly string[];
  readonly legacyTestRoots?: readonly string[];
  // Explicit separation of local code. Selectors are exact relative files or directory prefixes.
  readonly dependencyExclusions?: readonly {
    readonly from: string;
    readonly to: string;
    readonly imports: "all" | "runtime";
    readonly reach: "direct" | "transitive";
  }[];
  // Paths under the app root the kit never lists or reads, such as generated evidence. Nothing may import
  // from them, since an import into a path the kit cannot see would be a lost edge.
  readonly ignore?: readonly string[];
  // The words that mark debt in a comment, where debt never lives (R3, comments).
  readonly debtMarkers: readonly string[];
  // How many statements one change may add to a legacy module, each only a call into placed code. It is
  // the Kit's, like the words above: an app's config can't raise it, since the rule holds in every app.
  readonly legacyGrowth: number;
  readonly layerNames?: {
    readonly primitives: string;
    readonly readings: string;
    readonly adapters: string;
    readonly compositions: string;
  };
  readonly packages?: readonly {
    readonly name: string;
    readonly capabilities: readonly string[];
    // Read for one release in place of hosts.<name>.provides.
    readonly entrypointExports?: readonly string[];
  }[];
  readonly adapters?: readonly {
    readonly module: string;
    readonly export: string;
    readonly capability: string;
    readonly kind: "external" | "produce" | "apply";
    readonly zones: readonly ("core" | "shell" | "substrate")[];
    readonly contract?: { readonly type: string } | { readonly parameter: number };
    readonly primitives?: readonly ("clock" | "randomness")[];
    readonly globals?: readonly string[];
    // Packages only this adapter's module may import at runtime, granting its capability there.
    readonly packages?: readonly string[];
  }[];
}

export interface Host {
  // "dom", "webworker", "node", or a package whose ambient declarations the host provides.
  readonly lib: readonly string[];
  readonly zone?: "shell" | "substrate";
  readonly entries?: readonly string[];
  readonly roots?: readonly string[];
  // Named runtime exports of an effectful package that this host's entries may import.
  readonly provides?: Readonly<Record<string, readonly string[]>>;
  // `<package>#<type>`: a function literal of this type is a program in this host.
  readonly enteredBy?: readonly string[];
}

export const DEFAULT_CONFIG: KitConfig = {
  srcRoot: "src",
  oracleRoot: "oracle",
  specRoot: "spec",
  termsFile: "spec/terms.md",
  connectors: ["of", "to", "by", "at", "in", "on", "is", "a", "the"],
  plurals: ["s", "es"],
  anchor: "\\{#[\\w-]+\\}",
  debtMarkers: ["TODO", "FIXME", "XXX", "HACK"],
  legacyGrowth: 0,
};
