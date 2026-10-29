// The config an app declares; every root is relative to the app root the snapshot was read from.
export interface KitConfig {
  // The app's name, as Kit's output names it.
  readonly app?: string;
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
  // Exact executable entrypoints outside zones, including claim proofs. This grants wiring permission
  // only to each named file; its authority and dependencies remain checked.
  readonly exceptions?: readonly string[];
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
  // What `kit verify` requires: whole-tree checks, each one command, run with the tests or after them, and the
  // command that runs one test file `{test}` for every test under the directories `under` lists. A test command that writes the test's
  // LCOV report into the directory `{dir}` keeps what each test ran, and turns on the rules that read it.
  readonly verify?: {
    readonly checks: readonly { readonly id: string; readonly command: string; readonly after?: "tests" }[];
    readonly tests?: { readonly command: string; readonly under: readonly string[] };
    // The ref prefix on `origin` under which kept passes are shared with every other clone, one ref per runtime
    // and day.
    readonly share?: string;
  };
  readonly layerNames?: {
    readonly primitives: string;
    readonly readings: string;
    readonly adapters: string;
    readonly compositions: string;
  };
  readonly packages?: readonly {
    readonly name: string;
    readonly capabilities: readonly string[];
    // An effectful package boundary restricted to exact entrypoints and these named runtime exports.
    // This is not a purity declaration; callbacks retain the package's capabilities.
    readonly entrypointExports?: readonly string[];
  }[];
  readonly adapters?: readonly {
    readonly module: string;
    readonly export: string;
    readonly capability: string;
    readonly kind: "external" | "produce" | "apply";
    readonly zones: readonly ("core" | "shell" | "substrate")[];
    readonly contract?: { readonly type: string };
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
};
