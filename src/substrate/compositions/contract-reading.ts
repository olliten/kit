import ts from "typescript";
import type { ProgramScope } from "../primitives/program-scope.js";

// The identities a type names in the checked sources: the contract it declares, the ports its operations
// return, its operation names and the named types it is made of.
export function contractReading({ checker, local, source }: ProgramScope) {
  const operationsOf = (type: ts.Type): string[] =>
    type
      .getProperties()
      .filter((property) => {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        return (
          declaration !== undefined &&
          checker.getTypeOfSymbolAtLocation(property, declaration).getCallSignatures().length >
            0
        );
      })
      .map((property) => property.name);
  const portsOf = (type: ts.Type): { ports?: { file: string; name: string }[] } => {
    const ports = new Map<string, { file: string; name: string }>();
    for (const property of type.getProperties()) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (declaration === undefined) continue;
      for (const signature of checker.getTypeOfSymbolAtLocation(property, declaration).getCallSignatures()) {
        const returned = checker.getReturnTypeOfSignature(signature);
        const port = checker.getAwaitedType(returned) ?? returned;
        const symbol = port.aliasSymbol ?? port.symbol;
        const home = symbol?.declarations?.[0];
        if (home === undefined || !source.has(local(home.getSourceFile().fileName))) continue;
        // Plain data returned by an operation is a result, not a port: only a type with operations is held.
        if (!(ts.isInterfaceDeclaration(home) || ts.isTypeAliasDeclaration(home)) || operationsOf(port).length === 0) continue;
        const identity = { file: local(home.getSourceFile().fileName), name: symbol?.name ?? "" };
        ports.set(`${identity.file}:${identity.name}`, identity);
      }
    }
    return ports.size === 0 ? {} : { ports: [...ports.values()] };
  };
  const contractIdentity = (type: ts.Type): { file: string; name: string } | null => {
    const symbol = type.aliasSymbol ?? type.symbol;
    const declaration = symbol?.declarations?.[0];
    return declaration !== undefined &&
      (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) &&
      source.has(local(declaration.getSourceFile().fileName))
      ? { file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }
      : null;
  };
  const typeNames = (type: ts.Type): { file: string; name: string }[] => {
    const alias = type.aliasSymbol?.declarations?.[0];
    if (alias !== undefined)
      return [
        { file: local(alias.getSourceFile().fileName), name: type.aliasSymbol?.name ?? "" },
      ];
    if (type.isUnionOrIntersection()) return type.types.flatMap(typeNames);
    const symbol = type.aliasSymbol ?? type.symbol;
    const declaration = symbol?.declarations?.[0];
    return declaration === undefined
      ? []
      : [{ file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }];
  };
  return { operationsOf, portsOf, contractIdentity, typeNames };
}

export type ContractReading = ReturnType<typeof contractReading>;
