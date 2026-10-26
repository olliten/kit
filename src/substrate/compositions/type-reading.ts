import { basename, join } from "node:path";
import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import { moduleFileOf } from "../../core/readings/placement-of.js";
import type { ProgramScope } from "../primitives/program-scope.js";

type Project = CompilerFacts["projects"][number];
export type NativeAuthority = NonNullable<Project["parameters"][number]["nativeAuthority"]>[number];

/**
 * The built-in collections whose own methods are data access, not behaviour a caller supplies. Binary data is
 * one of them: a typed array, its buffer and a view over it only read and write their own memory.
 */
const DATA_COLLECTIONS: readonly string[] = [
  "Array",
  "ReadonlyArray",
  "Map",
  "ReadonlyMap",
  "Set",
  "ReadonlySet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
];
/** The host types that are values: they parse, format or transcode what they are given and do no I/O. */
const VALUE_TYPES: readonly string[] = ["URL", "URLSearchParams", "TextEncoder", "TextDecoder"];
/** The static members of a value type's constructor that are as pure as its instances. */
export const VALUE_STATICS: readonly string[] = ["canParse", "parse"];
const HOST_DECLARATIONS = /(?:^|\/)node_modules\/@types\/node\//;

// What the checker says a type carries: the native host authority it reaches, the identities it names, whether
// it is callable or an accessor, and whether a caller can hand it behaviour.
export function typeReading({ appRoot, config, program, checker, local, source, workerTypes }: ProgramScope) {
  type TypeFacts = {
    readonly callable: boolean;
    readonly accessor: boolean;
    readonly types: readonly { readonly file: string; readonly name: string }[];
  };
  const completeTypeFacts = new Map<ts.Type, TypeFacts>();
  const completeArgumentFacts = new Map<ts.Type, TypeFacts>();
  const completeAdapterArgumentFacts = new Map<ts.Type, TypeFacts>();
  const referenceType = (type: ts.Type): type is ts.TypeReference =>
    "objectFlags" in type &&
    typeof type.objectFlags === "number" &&
    (type.objectFlags & ts.ObjectFlags.Reference) !== 0;
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
  const libCollection = (symbol: ts.Symbol | undefined): boolean =>
    symbol !== undefined &&
    DATA_COLLECTIONS.includes(symbol.name) &&
    symbol.declarations?.some((node) =>
      program.isSourceFileDefaultLibrary(node.getSourceFile()),
    ) === true;
  const typeFacts = (
    type: ts.Type,
    seen = new Set<ts.Type>(),
    supplied: boolean | "adapter" = false,
  ): TypeFacts => {
    const cache =
      supplied === "adapter"
        ? completeAdapterArgumentFacts
        : supplied
          ? completeArgumentFacts
          : completeTypeFacts;
    const complete = seen.size === 0;
    if (complete) {
      const cached = cache.get(type);
      if (cached !== undefined) return cached;
    }
    if (seen.has(type)) return { callable: false, accessor: false, types: [] };
    seen.add(type);
    const symbol = type.aliasSymbol ?? type.symbol;
    const declaration = symbol?.declarations?.[0];
    const own =
      declaration === undefined
        ? []
        : [{ file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }];
    let children: readonly ts.Type[] = [];
    if (type.isUnionOrIntersection()) children = type.types;
    else if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
      const constraint = checker.getBaseConstraintOfType(type);
      children = constraint === undefined ? [] : [constraint];
    } else if (
      checker.isArrayLikeType(type) ||
      checker.isTupleType(type) ||
      libCollection(symbol) ||
      hostValue(symbol)
    ) {
      const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      children = [
        ...(element === undefined ? [] : [element]),
        ...(referenceType(type) ? checker.getTypeArguments(type) : []),
        ...type.getProperties().flatMap((property) => {
          const declaration = property.valueDeclaration ?? property.declarations?.[0];
          if (
            declaration === undefined ||
            (supplied && program.isSourceFileDefaultLibrary(declaration.getSourceFile())) ||
            (hostValue(symbol) && property.declarations?.every(valueMember) === true) ||
            (ts.isMethodSignature(declaration) &&
              ts.isInterfaceDeclaration(declaration.parent) &&
              DATA_COLLECTIONS.includes(declaration.parent.name.text) &&
              /^lib\.es[\w.]*\.d\.ts$/.test(basename(declaration.getSourceFile().fileName)))
          )
            return [];
          return [checker.getTypeOfSymbolAtLocation(property, declaration)];
        }),
      ];
    } else if (
      (type.flags & ts.TypeFlags.Object) !== 0 &&
      !symbol?.declarations?.some(
        (node) => ts.isClassDeclaration(node) || ts.isClassExpression(node),
      )
    )
      children = type.getProperties().flatMap((property) => {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        return declaration === undefined ||
          (supplied && program.isSourceFileDefaultLibrary(declaration.getSourceFile()))
          ? []
          : [checker.getTypeOfSymbolAtLocation(property, declaration)];
      });
    const facts = [
      ...children,
      ...(type.aliasTypeArguments ?? []),
      ...(supplied && referenceType(type) ? checker.getTypeArguments(type) : []),
    ].map((child) => typeFacts(child, seen, supplied));
    const result: TypeFacts = {
      callable: type.getCallSignatures().length > 0 || facts.some((fact) => fact.callable),
      accessor:
        (!hostValue(symbol) &&
          symbol?.declarations?.some(
            (node) => ts.isClassDeclaration(node) || ts.isClassExpression(node),
          ) === true) ||
        type
          .getProperties()
          .some((property) =>
            property.declarations?.some(
              (node) =>
                ts.isGetAccessorDeclaration(node) &&
                !valueMember(node) &&
                (supplied !== "adapter" ||
                  !program.isSourceFileDefaultLibrary(node.getSourceFile())),
            ),
          ) ||
        facts.some((fact) => fact.accessor),
      types: [
        ...new Map(
          [...own, ...facts.flatMap((fact) => fact.types)].map((identity) => [
            `${identity.file}:${identity.name}`,
            identity,
          ]),
        ).values(),
      ],
    };
    if (complete) cache.set(type, result);
    return result;
  };
  const parameterFacts = (
    type: ts.Type,
  ): TypeFacts & {
    readonly executable: boolean;
    readonly nativeAuthority: readonly NativeAuthority[];
  } => {
    const supplied = typeFacts(type, new Set(), "adapter");
    return {
      ...typeFacts(type),
      executable: supplied.callable || supplied.accessor,
      nativeAuthority: nativeAuthorityOf(type),
    };
  };
  // A registered adapter's contract, and each port its operations return, name the adapter whose behaviour
  // they carry, so a module taking one shows that adapter in its types.
  let registered: Set<string> | undefined;
  const contractType = (type: ts.Type): boolean => {
    if (registered === undefined) {
      registered = new Set();
      for (const adapter of config.adapters ?? []) {
        const name = adapter.contract?.type;
        const file = program.getSourceFile(
          join(appRoot, moduleFileOf(adapter.module, config.srcRoot, config.layerNames)),
        );
        const module = file === undefined ? undefined : checker.getSymbolAtLocation(file);
        const symbol = module === undefined ? undefined : checker.getExportsOfModule(module).find((each) => each.name === name);
        if (symbol === undefined) continue;
        const declared = checker.getDeclaredTypeOfSymbol(symbol);
        for (const identity of [contractIdentity(declared), ...(portsOf(declared).ports ?? [])])
          if (identity !== null) registered.add(`${identity.file}:${identity.name}`);
      }
    }
    const identity = contractIdentity(type);
    return identity !== null && registered.has(`${identity.file}:${identity.name}`);
  };
  // A handle of a package an adapter declares is that adapter's to take.
  const handleOf = (type: ts.Type, packages: readonly string[]): boolean => {
    const home = (type.aliasSymbol ?? type.symbol)?.declarations?.[0]?.getSourceFile().fileName ?? "";
    return packages.some((name) => home.includes(`/node_modules/${name}/`));
  };
  // What a caller can hand a value: behaviour, when a parameter, a writable property or a mutable collection
  // it exposes takes a callable, an accessor or an object with operations that is not a registered contract,
  // nor a handle of a package the value's own adapter declares.
  const acceptsBehaviour = (type: ts.Type, packages: readonly string[] = [], seen = new Set<ts.Type>()): boolean => {
    if (seen.has(type) || contractType(type) || handleOf(type, packages)) return false;
    seen.add(type);
    const executable = (candidate: ts.Type): boolean =>
      parameterFacts(candidate).executable && !contractType(candidate) && !handleOf(candidate, packages);
    if (type.isUnionOrIntersection()) return type.types.some((member) => acceptsBehaviour(member, packages, seen));
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()])
      if (
        signature.getParameters().some((parameter) => executable(checker.getTypeOfSymbol(parameter))) ||
        acceptsBehaviour(checker.getReturnTypeOfSignature(signature), packages, seen)
      )
        return true;
    if (checker.isArrayType(type) || libCollection(type.symbol))
      return (
        !type.symbol.name.startsWith("Readonly") &&
        referenceType(type) &&
        checker.getTypeArguments(type).some(executable)
      );
    return type.getProperties().some((property) => {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return false;
      const value = checker.getTypeOfSymbolAtLocation(property, declaration);
      const writable =
        (ts.isPropertyDeclaration(declaration) ||
          ts.isPropertySignature(declaration) ||
          ts.isPropertyAssignment(declaration) ||
          ts.isShorthandPropertyAssignment(declaration) ||
          ts.isSetAccessorDeclaration(declaration)) &&
        (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) === 0;
      return (writable && executable(value)) || acceptsBehaviour(value, packages, seen);
    });
  };
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
  return {
    nativeLibrary,
    hostValue,
    nativeMember,
    nativeAuthorityOf,
    nativeMemberAuthority,
    nativeContract,
    typeFacts,
    parameterFacts,
    acceptsBehaviour,
    operationsOf,
    portsOf,
    contractIdentity,
    typeNames,
  };
}
