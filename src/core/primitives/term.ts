// A line `- **<term>** — <meaning>` of the terms file, optionally ending `Retired: <word>, <word>.`:
// the retired words this term replaces. `line` is 1-based.
export interface SpecTerm {
  readonly term: string;
  readonly meaning: string;
  readonly retired: readonly string[];
  readonly line: number;
  readonly metadata?:
    | {
        readonly kind: "module";
        readonly role: "fact" | "derived" | "adapter" | "composition";
        readonly zone: "core" | "shell" | "substrate";
        readonly references: readonly string[];
      }
    | {
        readonly kind: "field";
        readonly owner: string;
        readonly declaration: string;
        readonly property: string;
        readonly typeOwner: string;
        readonly typeName: string;
        readonly absence: readonly ("undefined" | "null")[];
      }
    | { readonly kind: "plain"; readonly scalar: "string" | "number" | "boolean" };
}

export interface TermSyntaxIssue {
  readonly term: string;
  readonly line: number;
  readonly detail: string;
}
