// A name a source file exports: `export function|const|class|type|interface <name>`.
export interface ExportedSymbol {
  readonly file: string;
  readonly name: string;
}
