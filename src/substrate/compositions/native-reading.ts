import { basename } from "node:path";
import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { ProgramScope } from "../primitives/program-scope.js";

type Project = CompilerFacts["projects"][number];
export type NativeAuthority = NonNullable<Project["parameters"][number]["nativeAuthority"]>[number];

/** The host types that are values: they parse, format or transcode what they are given and do no I/O. */
const VALUE_TYPES: readonly string[] = ["URL", "URLSearchParams", "TextEncoder", "TextDecoder"];
/** The static members of a value type's constructor that are as pure as its instances. */
export const VALUE_STATICS: readonly string[] = ["canParse", "parse"];
const HOST_DECLARATIONS = /(?:^|\/)node_modules\/@types\/node\//;

export const referenceType = (type: ts.Type): type is ts.TypeReference =>
  "objectFlags" in type &&
  typeof type.objectFlags === "number" &&
  (type.objectFlags & ts.ObjectFlags.Reference) !== 0;

// What host authority the checker says a type or member reaches: the DOM or host declaration that roots it,
// its bases, and whether only a window host has it. A value type such as URL reaches none.
export function nativeReading({ program, checker, local, workerTypes }: ProgramScope) {
  type NativeType = NativeAuthority["root"];
  const nativeLibrary = (node: ts.Node): boolean =>
    program.isSourceFileDefaultLibrary(node.getSourceFile()) &&
    /^lib\.dom(?:\.[\w-]+)*\.d\.ts$/.test(basename(node.getSourceFile().fileName));
  const hostDeclaration = (node: ts.Node): boolean =>
    program.isSourceFileDefaultLibrary(node.getSourceFile()) ||
    HOST_DECLARATIONS.test(node.getSourceFile().fileName);
  // Only the host's own declaration of a value type is a value; a project's own augmentation of it is
  // behaviour like any other.
  const hostValue = (symbol: ts.Symbol | undefined): boolean =>
    symbol !== undefined &&
    VALUE_TYPES.includes(symbol.name) &&
    symbol.declarations?.some(hostDeclaration) === true;
  // A value type's own members, and the pure statics of its constructor, are data access. Every other
  // static, such as the object-URL registry on URL, stays native.
  const valueMember = (node: ts.Node): boolean => {
    if (!hostDeclaration(node)) return false;
    const owner = node.parent;
    if (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner))
      return (
        VALUE_TYPES.includes(owner.name?.text ?? "") &&
        (!ts.canHaveModifiers(node) ||
          !ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ||
          (ts.isMethodDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            VALUE_STATICS.includes(node.name.text)))
      );
    return (
      ts.isTypeLiteralNode(owner) &&
      ts.isVariableDeclaration(owner.parent) &&
      ts.isIdentifier(owner.parent.name) &&
      VALUE_TYPES.includes(owner.parent.name.text) &&
      (ts.isMethodSignature(node) || ts.isPropertySignature(node)) &&
      ts.isIdentifier(node.name) &&
      VALUE_STATICS.includes(node.name.text)
    );
  };
  const nativeMember = (symbol: ts.Symbol): boolean =>
    symbol.declarations?.some(
      (node) =>
        nativeLibrary(node) &&
        !valueMember(node) &&
        (ts.isMethodSignature(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node)),
    ) === true;
  const nativeType = (type: ts.Type): NativeType | null => {
    const symbol = type.symbol;
    if (hostValue(symbol)) return null;
    const declaration = symbol?.declarations?.find(
      (node) =>
        nativeLibrary(node) && (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)),
    );
    // Constructor-backed Window objects can mutate the document through properties alone. Plain
    // option dictionaries have no host value declaration and remain supplied data.
    const windowObject = symbol !== undefined && !workerTypes.has(symbol.name) &&
      symbol.declarations?.some((node) => nativeLibrary(node) && ts.isVariableDeclaration(node)) === true;
    return declaration !== undefined &&
      (windowObject || type
        .getProperties()
        .some((property) =>
          property.declarations?.some(
            (node) =>
              nativeLibrary(node) &&
              (ts.isMethodSignature(node) ||
                ts.isMethodDeclaration(node) ||
                ts.isGetAccessorDeclaration(node) ||
                ts.isSetAccessorDeclaration(node)),
          ),
        ))
      ? { file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }
      : null;
  };
  const baseTypes = (type: ts.Type): readonly ts.BaseType[] => {
    const target = referenceType(type) ? type.target : type;
    return target.isClassOrInterface() ? checker.getBaseTypes(target) : [];
  };
  const nativeCache = new Map<ts.Type, readonly NativeAuthority[]>();
  const nativeAuthorityOf = (
    type: ts.Type,
    seen = new Set<ts.Type>(),
  ): readonly NativeAuthority[] => {
    const complete = seen.size === 0;
    const cached = complete ? nativeCache.get(type) : undefined;
    if (cached !== undefined) return cached;
    if (seen.has(type)) return [];
    seen.add(type);
    const root = nativeType(type);
    let result: readonly NativeAuthority[];
    if (root !== null) {
      const queue = [...baseTypes(type)];
      const visited = new Set<ts.Type>();
      const bases: NativeType[] = [];
      for (const base of queue) {
        if (visited.has(base)) continue;
        visited.add(base);
        const identity = nativeType(base);
        if (identity !== null) bases.push(identity);
        queue.push(...baseTypes(base));
      }
      result = [{
        root,
        bases,
        ...(!workerTypes.has(root.name) ? { windowOnly: true as const } : {}),
      }];
    } else {
      const constraint =
        (type.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.IndexedAccess)) !== 0
          ? checker.getBaseConstraintOfType(type)
          : undefined;
      const contents = type.isUnionOrIntersection()
        ? type.types
        : type.getCallSignatures().length > 0
          ? []
          : [
              ...(constraint === undefined ? [] : [constraint]),
              ...(type.aliasTypeArguments ?? []),
              ...(referenceType(type) ? checker.getTypeArguments(type) : []),
              ...((type.flags & ts.TypeFlags.Object) === 0
                ? []
                : type.getProperties().flatMap((property) => {
                    const declaration = property.valueDeclaration ?? property.declarations?.[0];
                    return declaration !== undefined &&
                      (ts.isPropertySignature(declaration) ||
                        ts.isPropertyDeclaration(declaration) ||
                        ts.isPropertyAssignment(declaration) ||
                        ts.isShorthandPropertyAssignment(declaration) ||
                        (ts.isParameter(declaration) &&
                          ts.isConstructorDeclaration(declaration.parent) &&
                          ts.isParameterPropertyDeclaration(declaration, declaration.parent)))
                      ? [checker.getTypeOfSymbolAtLocation(property, declaration)]
                      : [];
                  })),
            ];
      const children = [
        ...type
          .getConstructSignatures()
          .map((signature) => checker.getReturnTypeOfSignature(signature)),
        ...contents,
      ];
      result = [
        ...new Map(
          children
            .flatMap((child) => nativeAuthorityOf(child, seen))
            .map((authority) => [`${authority.root.file}:${authority.root.name}`, authority]),
        ).values(),
      ];
    }
    if (complete) nativeCache.set(type, result);
    return result;
  };
  const nativeMemberAuthority = (
    member: ts.Symbol,
    receiver: ts.Type,
    location: ts.Node,
  ): readonly NativeAuthority[] => {
    const windowReceiver = (receiver.isUnionOrIntersection() ? receiver.types : [receiver])
      .some((type) => {
        const identity = nativeType(type);
        return identity !== null && !workerTypes.has(identity.name);
      });
    if (nativeMember(member) || windowReceiver) return nativeAuthorityOf(receiver);
    const type = checker.getTypeOfSymbolAtLocation(member, location);
    return type.getConstructSignatures().length > 0 ? nativeAuthorityOf(type) : [];
  };
  const nativeContract = (
    type: ts.Type,
  ): { readonly nativeAuthority: readonly NativeAuthority[] } => ({
    nativeAuthority: [
      ...new Map(
        [
          ...nativeAuthorityOf(type),
          ...[
            ...type.getCallSignatures(),
            ...type.getProperties().flatMap((property) => {
              const declaration = property.valueDeclaration ?? property.declarations?.[0];
              return declaration === undefined
                ? []
                : checker.getTypeOfSymbolAtLocation(property, declaration).getCallSignatures();
            }),
          ].flatMap((signature) => [
            ...nativeAuthorityOf(checker.getReturnTypeOfSignature(signature)),
            ...signature.parameters.flatMap((parameter) => {
              const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
              return declaration === undefined
                ? []
                : nativeAuthorityOf(checker.getTypeOfSymbolAtLocation(parameter, declaration));
            }),
          ]),
        ].map((authority) => [`${authority.root.file}:${authority.root.name}`, authority]),
      ).values(),
    ],
  });
  return {
    nativeLibrary,
    hostValue,
    valueMember,
    nativeMember,
    nativeAuthorityOf,
    nativeMemberAuthority,
    nativeContract,
  };
}

export type NativeReading = ReturnType<typeof nativeReading>;
