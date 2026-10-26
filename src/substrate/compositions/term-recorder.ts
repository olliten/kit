import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { ProgramScope } from "../primitives/program-scope.js";
import type { FileScope } from "./file-scope.js";
import type { SyntaxReading } from "./syntax-reading.js";

type TermFacts = NonNullable<CompilerFacts["projects"][number]["termFacts"]>;

// What the glossary checks read of a source file: whether it holds only facts (types, imports and literal
// constants), and the properties of each type it declares with the types their annotations name.
export function termRecorder({ checker }: ProgramScope, { literal, annotation }: SyntaxReading) {
  const sources: TermFacts["sources"][number][] = [];
  const types: TermFacts["types"][number][] = [];
  return {
    sources,
    types,
    end({ sf, path }: FileScope): void {
      sources.push({
        file: path,
        factOnly: sf.statements.every(
          (statement) =>
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isImportDeclaration(statement) ||
            ts.isExportDeclaration(statement) ||
            (ts.isVariableStatement(statement) &&
              (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
              statement.declarationList.declarations.every(
                (declaration) => declaration.initializer !== undefined && literal(declaration.initializer),
              )),
        ),
      });
      for (const statement of sf.statements) {
        if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) continue;
        const type = checker.getTypeAtLocation(statement);
        const properties = checker.getPropertiesOfType(type).map((property) => {
          const declaration = property.declarations?.find(ts.isPropertySignature);
          const facts = declaration?.type
            ? annotation(declaration.type)
            : { types: [], absence: [], other: false, unsupported: true };
          const absence: ("undefined" | "null")[] = [...facts.absence];
          if (declaration?.questionToken && !absence.includes("undefined")) absence.push("undefined");
          return { name: property.name, ...facts, absence };
        });
        types.push({ file: path, name: statement.name.text, properties });
      }
    },
  };
}
