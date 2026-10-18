// The config an app declares; every root is relative to the app root the snapshot was read from.
export interface KitConfig {
  readonly srcRoot: string;
  readonly oracleRoot: string;
  readonly specRoot: string;
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
  readonly exceptions?: readonly string[];
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

export const DEFAULT_CONFIG: KitConfig = {
  srcRoot: "src",
  oracleRoot: "oracle",
  specRoot: "spec",
  termsFile: "spec/terms.md",
  connectors: ["of", "to", "by", "at", "in", "on", "is", "a", "the"],
  plurals: ["s", "es"],
  anchor: "\\{#[\\w-]+\\}",
  debtMarkers: ["TODO", "FIXME", "XXX", "HACK"],
  legacyGrowth: 5,
};
