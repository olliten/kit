import type { KitConfig } from "../primitives/default-config.js";

// One read of a codebase. Every path is relative to the app root, with "/" separators.
export type FileType = "source" | "test" | "spec" | "other";

export interface SnapshotFile {
  readonly path: string;
  readonly type: FileType;
}

// An import between two files of the snapshot (package imports are not recorded).
export interface ImportEdge {
  readonly from: string;
  readonly to: string;
}

// A spec heading `### <zone>/<layer>/<name>`: `name` is the artifact path, `file` the topic file.
export interface SpecHeading {
  readonly file: string;
  readonly name: string;
}

// A line `- **<term>** — <meaning>` of the terms file, optionally ending `Retired: <word>, <word>.`:
// the retired words this term replaces. `line` is 1-based.
export interface SpecTerm {
  readonly term: string;
  readonly meaning: string;
  readonly retired: readonly string[];
  readonly line: number;
}

// The text of one spec file; the terms file's own definition lines are left out.
export interface SpecProse {
  readonly file: string;
  readonly text: string;
}

// A name a source file exports: `export function|const|class|type|interface <name>`.
export interface ExportedSymbol {
  readonly file: string;
  readonly name: string;
}

// One comment of a source or test file, as written, at the line where it starts.
export interface SnapshotComment {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface Snapshot {
  readonly claims?: readonly {
    readonly file: string;
    readonly anchor: string;
    readonly line: number;
  }[];
  readonly claimReferences?: readonly {
    readonly file: string;
    readonly anchor: string;
    readonly line: number;
  }[];
  readonly files: readonly SnapshotFile[];
  readonly imports: readonly ImportEdge[];
  readonly headings: readonly SpecHeading[];
  readonly terms: readonly SpecTerm[];
  readonly prose: readonly SpecProse[];
  readonly symbols: readonly ExportedSymbol[];
  readonly comments: readonly SnapshotComment[];
  readonly config: KitConfig;
  readonly compiler?: {
    readonly version: string;
    readonly projects: readonly {
      readonly file: string;
      readonly zone: "core" | "shell" | "substrate" | null;
      readonly settings: {
        readonly lib: readonly string[];
        // null means automatic ambient type discovery; [] explicitly disables it.
        readonly types: readonly string[] | null;
        readonly strict: boolean;
        readonly noImplicitAny: boolean;
        readonly strictNullChecks: boolean;
        readonly isolatedDeclarations: boolean;
      };
      readonly files: readonly string[];
      readonly ambientFiles: readonly string[];
      readonly diagnostics: readonly {
        readonly file: string | null;
        readonly code: number;
        readonly message: string;
        readonly start: number | null;
        readonly length: number | null;
        readonly category: "warning" | "error" | "suggestion" | "message";
      }[];
      readonly imports: readonly {
        readonly file: string;
        readonly specifier: string;
        readonly target: string | null;
        readonly typeOnly: boolean;
      }[];
      readonly parameters: readonly {
        readonly file: string;
        readonly start: number;
        readonly name: string;
        readonly callable: boolean;
        readonly accessor: boolean;
        readonly types: readonly { readonly file: string; readonly name: string }[];
      }[];
      readonly contracts: readonly {
        readonly file: string;
        readonly name: string;
        readonly parameter: number | null;
        readonly operations: readonly string[];
        readonly type: { readonly file: string; readonly name: string } | null;
      }[];
      readonly accesses: readonly {
        readonly file: string;
        readonly start: number;
        readonly kind: "clock" | "randomness" | "dynamic";
      }[];
      readonly constructions: readonly {
        readonly file: string;
        readonly start: number;
        readonly types: readonly { readonly file: string; readonly name: string }[];
        readonly spread: boolean;
        readonly callable: boolean;
      }[];
      readonly connections: readonly {
        readonly file: string;
        readonly start: number;
        readonly target: string | null;
        readonly callableOrigins: readonly (string | null)[];
        readonly builtin: boolean;
      }[];
      readonly exports: readonly {
        readonly file: string;
        readonly name: string;
        readonly declarationFile: string;
        readonly type: string;
        readonly explicit: boolean;
        readonly any: boolean;
        readonly unknown: boolean;
        readonly primitive: boolean;
        readonly union: boolean;
        readonly satisfies: string | null;
        readonly resultType: { readonly file: string; readonly name: string } | null;
      }[];
      readonly globals: readonly {
        readonly file: string;
        readonly name: string;
        readonly start: number;
        readonly declarationFile: string | null;
        readonly runtime: boolean;
      }[];
      readonly escapes: readonly {
        readonly file: string;
        readonly start: number;
        readonly kind: "any" | "assertion" | "non-null" | "ignore" | "nocheck" | "expect-error";
      }[];
    }[];
  };
}
