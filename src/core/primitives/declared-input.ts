export type InputDecl =
  | { readonly file: string }
  | { readonly tree: string; readonly suffix: string }
  | { readonly present: string };

export type FileMap = ReadonlyMap<string, string | Uint8Array>;

export interface InputDeclaration {
  readonly name: string;
  readonly inputs: readonly InputDecl[];
  readonly code: readonly InputDecl[];
}

export interface KeyContext {
  readonly format: string;
  readonly runtime: string;
}
