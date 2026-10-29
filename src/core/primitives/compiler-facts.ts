export interface NativeAuthority {
  readonly root: { readonly file: string; readonly name: string };
  readonly bases: readonly { readonly file: string; readonly name: string }[];
  // A DOM host type unavailable in the compiler's worker host declarations.
  readonly windowOnly?: true;
}

export interface CompilerFacts {
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
      // An ambient module's declaration home establishes a direct type boundary, not its runtime imports.
      readonly declarationTarget?: string;
      readonly typeOnly: boolean;
      // Original names of named runtime imports. Null is a namespace, default, re-export or dynamic edge;
      // an absent fact cannot establish a restricted package boundary.
      readonly namedImports?: readonly string[] | null;
    }[];
    readonly termFacts?: {
      readonly sources: readonly { readonly file: string; readonly factOnly: boolean }[];
      readonly types: readonly {
        readonly file: string;
        readonly name: string;
        readonly properties: readonly {
          readonly name: string;
          readonly types: readonly { readonly file: string; readonly name: string }[];
          readonly absence: readonly ("undefined" | "null")[];
          readonly other: boolean;
          readonly unsupported: boolean;
        }[];
      }[];
    };
    readonly parameters: readonly {
      readonly file: string;
      readonly start: number;
      readonly name: string;
      readonly callable: boolean;
      readonly accessor: boolean;
      readonly nativeAuthority?: readonly NativeAuthority[];
      readonly types: readonly { readonly file: string; readonly name: string }[];
    }[];
    readonly contracts: readonly {
      readonly file: string;
      readonly name: string;
      readonly operations: readonly string[];
      readonly type: { readonly file: string; readonly name: string } | null;
      readonly nativeAuthority?: readonly NativeAuthority[];
      // The named project types its operations return, awaited: the ports a caller holds after using it.
      readonly ports?: readonly { readonly file: string; readonly name: string }[];
    }[];
    readonly accesses: readonly {
      readonly file: string;
      readonly start: number;
      readonly kind: "clock" | "randomness" | "dynamic" | "native";
      // Where it is, by its enclosing names and syntax rather than its offset, so an edit elsewhere keeps it.
      readonly site?: string;
      readonly nativeAuthority?: readonly NativeAuthority[];
    }[];
    readonly constructions: readonly {
      readonly file: string;
      readonly start: number;
      readonly site?: string;
      readonly types: readonly { readonly file: string; readonly name: string }[];
      readonly spread: boolean;
      readonly callable: boolean;
    }[];
    // What each test file's code uses, followed through the declarations it names: the files whose code it
    // reaches, and the files it reaches in ways that can't be followed, charged whole.
    readonly proofs?: readonly {
      readonly file: string;
      readonly reached: readonly string[];
      readonly whole: readonly string[];
      // The top-level declarations of other files whose code it uses.
      readonly declarations?: readonly { readonly file: string; readonly name: string }[];
    }[];
    readonly exports: readonly {
      readonly file: string;
      readonly name: string;
      readonly declarationFile: string;
      readonly explicit: boolean;
      readonly any: boolean;
      readonly unknown: boolean;
      readonly primitive: boolean;
      readonly union: boolean;
      readonly satisfies: string | null;
      readonly resultType: { readonly file: string; readonly name: string } | null;
      // A caller can hand this value behaviour: a callable, an accessor or an object with operations.
      readonly acceptsBehaviour?: true;
    }[];
    readonly globals: readonly {
      readonly file: string;
      readonly name: string;
      readonly start: number;
      readonly declarationFile: string | null;
      readonly runtime: boolean;
      readonly nativeAuthority?: readonly NativeAuthority[];
      // A host value type such as URL, used as a value: it parses or transcodes and reaches no host.
      readonly value?: boolean;
    }[];
    readonly escapes: readonly {
      readonly file: string;
      readonly start: number;
      readonly site?: string;
      readonly kind: "any" | "assertion" | "non-null" | "ignore" | "nocheck" | "expect-error";
    }[];
    // The named functions of each checked source: the name a runtime reports, the line it starts on, an id
    // unique in its file, and the id of the named function holding it.
    readonly functions?: readonly {
      readonly file: string;
      readonly name: string;
      readonly line: number;
      readonly id: string;
      readonly holder: string | null;
    }[];
  }[];
}
