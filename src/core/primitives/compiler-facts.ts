interface NativeAuthority {
  readonly root: { readonly file: string; readonly name: string };
  readonly bases: readonly { readonly file: string; readonly name: string }[];
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
      readonly typeOnly: boolean;
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
      readonly executable?: boolean;
      readonly exported?: boolean;
      readonly nativeAuthority?: readonly NativeAuthority[];
      readonly types: readonly { readonly file: string; readonly name: string }[];
    }[];
    readonly contracts: readonly {
      readonly file: string;
      readonly name: string;
      readonly parameter: number | null;
      readonly operations: readonly string[];
      readonly type: { readonly file: string; readonly name: string } | null;
      readonly nativeAuthority?: readonly NativeAuthority[];
    }[];
    readonly accesses: readonly {
      readonly file: string;
      readonly start: number;
      readonly kind: "clock" | "randomness" | "dynamic" | "native";
      readonly nativeAuthority?: readonly NativeAuthority[];
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
      readonly callableBindings?: readonly {
        readonly source: { readonly file: string; readonly start: number } | null;
        readonly target: { readonly file: string; readonly start: number } | null;
      }[];
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
      readonly nativeAuthority?: readonly NativeAuthority[];
    }[];
    readonly escapes: readonly {
      readonly file: string;
      readonly start: number;
      readonly site?: string;
      readonly kind: "any" | "assertion" | "non-null" | "ignore" | "nocheck" | "expect-error";
    }[];
  }[];
}
