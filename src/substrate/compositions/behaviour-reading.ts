import { basename, join } from "node:path";
import ts from "typescript";
import { moduleFileOf } from "../../core/readings/placement-of.js";
import type { ProgramScope } from "../primitives/program-scope.js";
import type { ContractReading } from "./contract-reading.js";
import { type NativeAuthority, type NativeReading, referenceType } from "./native-reading.js";

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

// A const assertion makes every property of the literal it covers readonly, however deeply nested.
function constAsserted(declaration: ts.Node): boolean {
  let node = declaration.parent;
  while (
    node !== undefined &&
    (ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isParenthesizedExpression(node))
  )
    node = node.parent;
  return (
    node !== undefined &&
    (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === "const"
  );
}

// Whether a type is or accepts behaviour: callable, an accessor, or an object with operations a caller can hand
// it, apart from a registered adapter's contract and the handles of the packages that adapter declares.
export function behaviourReading(
  { appRoot, config, program, checker, local }: ProgramScope,
  { hostValue, valueMember, nativeAuthorityOf }: NativeReading,
  { portsOf, contractIdentity }: ContractReading,
) {
  type TypeFacts = {
    readonly callable: boolean;
    readonly accessor: boolean;
    readonly types: readonly { readonly file: string; readonly name: string }[];
  };
  const completeTypeFacts = new Map<ts.Type, TypeFacts>();
  const completeArgumentFacts = new Map<ts.Type, TypeFacts>();
  const completeAdapterArgumentFacts = new Map<ts.Type, TypeFacts>();
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
        (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) === 0 &&
        !constAsserted(declaration);
      return (writable && executable(value)) || acceptsBehaviour(value, packages, seen);
    });
  };
  return { typeFacts, parameterFacts, acceptsBehaviour };
}

export type BehaviourReading = ReturnType<typeof behaviourReading>;
