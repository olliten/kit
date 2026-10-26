import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { ProgramScope } from "../primitives/program-scope.js";
import type { BehaviourReading } from "./behaviour-reading.js";
import type { ContractReading } from "./contract-reading.js";
import type { FileScope } from "./file-scope.js";
import type { NativeReading } from "./native-reading.js";

type Project = CompilerFacts["projects"][number];

// The contracts a file declares, with their operations, ports and native authority, and the values it
// constructs of a named type: an object literal, or a class implementing an interface, which constructs that
// interface's values as a literal does.
export function contractRecorder(
  { checker }: ProgramScope,
  { nativeContract }: NativeReading,
  { operationsOf, portsOf, contractIdentity, typeNames }: ContractReading,
  { typeFacts }: BehaviourReading,
) {
  const contracts: Project["contracts"][number][] = [];
  const constructions: Project["constructions"][number][] = [];
  return {
    contracts,
    constructions,
    visit({ sf, path, site }: FileScope, node: ts.Node): void {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        const type = checker.getTypeAtLocation(node);
        contracts.push({
          file: path,
          name: node.name.text,
          operations: operationsOf(type),
          type: contractIdentity(type),
          ...nativeContract(type),
          ...portsOf(type),
        });
      }
      if (ts.isObjectLiteralExpression(node)) {
        const type = checker.getContextualType(node) ?? checker.getTypeAtLocation(node);
        constructions.push({
          file: path,
          start: node.getStart(sf),
          site: site(node, "construction"),
          callable: typeFacts(type).callable,
          types: [
            ...typeNames(type),
            ...node.properties.flatMap((property) =>
              ts.isSpreadAssignment(property) ? typeNames(checker.getTypeAtLocation(property.expression)) : [],
            ),
          ],
          spread: node.properties.some(ts.isSpreadAssignment),
        });
      }
      if (ts.isClassLike(node))
        for (const clause of node.heritageClauses ?? [])
          if (clause.token === ts.SyntaxKind.ImplementsKeyword)
            for (const implemented of clause.types)
              constructions.push({
                file: path,
                start: implemented.getStart(sf),
                site: site(implemented, "construction"),
                callable: false,
                types: typeNames(checker.getTypeAtLocation(implemented)),
                spread: false,
              });
    },
  };
}
