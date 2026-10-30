import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { ProgramScope } from "../primitives/program-scope.js";
import type { BehaviourReading } from "./behaviour-reading.js";
import type { FileScope } from "./file-scope.js";
import { type NativeAuthority, type NativeReading, VALUE_STATICS } from "./native-reading.js";
import type { SyntaxReading } from "./syntax-reading.js";

type Project = CompilerFacts["projects"][number];

// Where a file's code can acquire authority: the parameters of its exports and what their types grant, the
// raw primitives, dynamic code and native members it reaches, and the ambient globals it names. Only the
// window host has a global the worker host lacks.
export function authorityRecorder(
  { checker, local, source }: ProgramScope,
  workerGlobals: ReadonlySet<string>,
  { globalName, rawAccess }: SyntaxReading,
  { nativeLibrary, hostValue, nativeMember, nativeAuthorityOf, nativeMemberAuthority }: NativeReading,
  { parameterFacts }: BehaviourReading,
) {
  const parameters = new Map<ts.ParameterDeclaration, Project["parameters"][number]>();
  const accesses: Project["accesses"][number][] = [];
  const globals: Project["globals"][number][] = [];
  const selectionOf = (node: ts.Expression): string | undefined => {
    let selected = node;
    while (ts.isPropertyAccessExpression(selected.parent) && selected.parent.expression === selected)
      selected = selected.parent;
    if (ts.isElementAccessExpression(selected.parent) && selected.parent.expression === selected) return undefined;
    const parts: string[] = [];
    let root = selected;
    while (ts.isPropertyAccessExpression(root)) {
      parts.unshift(root.name.text);
      root = root.expression;
    }
    if (!ts.isIdentifier(root) || parts.length === 0) return undefined;
    const declaration = checker.getSymbolAtLocation(root)?.declarations?.find((d) => d.getSourceFile().isDeclarationFile);
    return declaration === undefined ? undefined : [root.text, ...parts].join(".");
  };
  const recordParameter = (parameter: ts.ParameterDeclaration): void => {
    const sf = parameter.getSourceFile();
    const file = local(sf.fileName);
    if (sf.isDeclarationFile || !source.has(file)) return;
    parameters.set(parameter, {
      file,
      start: parameter.getStart(sf),
      name: parameter.name.getText(sf),
      ...parameterFacts(checker.getTypeAtLocation(parameter)),
    });
  };
  const windowRoot = (declaration: ts.Declaration): NativeAuthority => ({
    root: { file: local(declaration.getSourceFile().fileName), name: "Window" },
    bases: [],
    windowOnly: true,
  });
  return {
    parameters,
    accesses,
    globals,
    visit({ sf, path, site }: FileScope, node: ts.Node, runtime: boolean): void {
      const access = (at: ts.Node, kind: "clock" | "randomness" | "dynamic"): void => {
        accesses.push({ file: path, start: at.getStart(sf), kind, site: site(at, kind) });
      };
      const native = (at: ts.Node, nativeAuthority: readonly NativeAuthority[]): void => {
        accesses.push({ file: path, start: at.getStart(sf), kind: "native", site: site(at, "native"), nativeAuthority });
      };
      if (
        ts.isFunctionDeclaration(node) &&
        node.name !== undefined &&
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        for (const parameter of node.parameters) recordParameter(parameter);
      if (
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isVariableDeclarationList(node.parent.parent) &&
        ts.isVariableStatement(node.parent.parent.parent) &&
        node.parent.parent.parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        for (const parameter of node.parameters) recordParameter(parameter);
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const specifier = node.arguments[0];
          if (specifier === undefined || !ts.isStringLiteralLike(specifier)) access(node, "dynamic");
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          globalName(node.expression.expression) === "Reflect" &&
          node.expression.name.text === "get" &&
          node.arguments[0] !== undefined &&
          globalName(node.arguments[0]) === "globalThis"
        )
          access(node, "dynamic");
        const raw = rawAccess(node.expression);
        if (raw !== null) access(node, raw);
      }
      if (ts.isPropertyAccessExpression(node)) {
        const raw = runtime ? rawAccess(node) : null;
        if (raw !== null) access(node, raw);
      }
      if (runtime && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
        const receiver = checker.getTypeAtLocation(node.expression);
        const key = ts.isElementAccessExpression(node) ? checker.getTypeAtLocation(node.argumentExpression) : null;
        const member = ts.isPropertyAccessExpression(node)
          ? checker.getSymbolAtLocation(node.name)
          : key?.isStringLiteral()
            ? receiver.getProperty(key.value)
            : undefined;
        const authority = member === undefined ? [] : nativeMemberAuthority(member, receiver, node);
        if (member !== undefined && (nativeMember(member) || authority.length > 0)) native(node, authority);
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
        const raw = rawAccess(node.name);
        if (raw !== null) access(node, raw);
        const owner = node.parent.parent;
        const key = node.propertyName ?? node.name;
        if (
          runtime &&
          ts.isObjectBindingPattern(node.parent) &&
          ts.isVariableDeclaration(owner) &&
          owner.initializer !== undefined &&
          (ts.isIdentifier(key) || ts.isStringLiteralLike(key))
        ) {
          const receiver = checker.getTypeAtLocation(owner.initializer);
          const member = receiver.getProperty(key.text);
          const authority = member === undefined ? [] : nativeMemberAuthority(member, receiver, node);
          if (member !== undefined && (nativeMember(member) || authority.length > 0)) native(node, authority);
        }
      }
      // A cast erases which global is reached, so the authority it acquires has no identity.
      if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && globalName(node.expression) === "globalThis")
        access(node, "dynamic");
      if (ts.isNewExpression(node)) {
        const name = globalName(node.expression);
        const kind =
          name === "Date" && (node.arguments?.length ?? 0) === 0 ? "clock" : name === "Function" ? "dynamic" : null;
        if (kind !== null) access(node, kind);
      }
      if (
        ts.isElementAccessExpression(node) &&
        (node.expression.getText(sf) === "globalThis" ||
          ["Date", "Math", "Reflect"].includes(globalName(node.expression) ?? ""))
      )
        access(node, "dynamic");
      if (ts.isIdentifier(node)) {
        if (
          runtime &&
          !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
          rawAccess(node) === "dynamic"
        )
          access(node, "dynamic");
        const symbol = checker.getSymbolAtLocation(node);
        const declaration = symbol?.declarations?.find((d) => d.getSourceFile().isDeclarationFile);
        if (
          declaration !== undefined &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
          !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
        ) {
          const type = checker.getTypeAtLocation(node);
          // A host function such as fetch hands out the native handles it returns, so calling it is
          // their authority even when the caller never touches a member of the result.
          const returned =
            ts.isFunctionDeclaration(declaration) && nativeLibrary(declaration)
              ? type
                  .getCallSignatures()
                  .flatMap((signature) => nativeAuthorityOf(checker.getReturnTypeOfSignature(signature)))
              : [];
          const reached =
            ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node ? node.parent.name.text : null;
          const windowAuthority =
            nativeLibrary(declaration) && !workerGlobals.has(node.text) ? [windowRoot(declaration)] : [];
          const selection = selectionOf(node);
          globals.push({
            file: path,
            name: node.text,
            start: node.getStart(sf),
            declarationFile: local(declaration.getSourceFile().fileName),
            runtime,
            ...(selection === undefined ? {} : { selection }),
            nativeAuthority: [
              ...new Map(
                [...nativeAuthorityOf(type), ...returned, ...windowAuthority].map((authority) => [
                  `${authority.root.file}:${authority.root.name}`,
                  authority,
                ]),
              ).values(),
            ],
            ...(hostValue(symbol) && (reached === null || reached === "prototype" || VALUE_STATICS.includes(reached))
              ? { value: true }
              : {}),
          });
        }
      }
      if (ts.isPropertyAccessExpression(node)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        const declaration = symbol?.declarations?.find((d) => d.getSourceFile().isDeclarationFile);
        if (declaration !== undefined) {
          const selection = selectionOf(node);
          globals.push({
            file: path,
            name: node.getText(sf),
            start: node.getStart(sf),
            declarationFile: local(declaration.getSourceFile().fileName),
            runtime,
            ...(selection === undefined ? {} : { selection }),
            ...(globalName(node.expression) === "globalThis" &&
            nativeLibrary(declaration) &&
            !workerGlobals.has(node.name.text)
              ? { nativeAuthority: [windowRoot(declaration)] }
              : {}),
          });
        }
      }
    },
  };
}
