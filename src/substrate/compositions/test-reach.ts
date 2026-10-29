import ts from "typescript";

// The files a test's code reaches, the top-level declarations in them it uses, and the files it reaches in
// ways that can't be followed, charged whole.
export interface TestReach {
  readonly reached: readonly string[];
  readonly whole: readonly string[];
  readonly declarations: readonly { readonly file: string; readonly name: string }[];
}

// The names a piece of code's top-level statement declares: the module-level declaration it belongs to.
function topLevelNames(node: ts.Node): readonly string[] {
  let top = node;
  while (top.parent !== undefined && !ts.isSourceFile(top.parent)) top = top.parent;
  if (ts.isSourceFile(top)) return [];
  const names = (name: ts.BindingName): string[] =>
    ts.isIdentifier(name)
      ? [name.text]
      : name.elements.flatMap((element) => (ts.isBindingElement(element) ? names(element.name) : []));
  if (ts.isVariableStatement(top)) return top.declarationList.declarations.flatMap((each) => names(each.name));
  const name =
    ts.isFunctionDeclaration(top) || ts.isClassDeclaration(top) || ts.isEnumDeclaration(top) ? top.name : undefined;
  return name === undefined ? [] : [name.text];
}

// A test reaches what its code can run or hold: the code its free names reach, followed through the
// declarations they name, and every statement that can change a mutable value it holds, since a value stored
// there later is held too. What cannot be followed to a declaration is charged as its whole file. Each piece of
// code is read once; a test's reach is the union over the pieces it leads to, and so are the files it read.
export function testReach(
  checker: ts.TypeChecker,
  source: ReadonlySet<string>,
  local: (file: string) => string,
  importTarget: (specifier: string, containingFile: string) => string | null,
): (argument: ts.Node) => TestReach & { readonly read: readonly string[] } {
  const unaliased = (symbol: ts.Symbol): ts.Symbol => {
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
    const target = checker.getAliasedSymbol(symbol);
    return (target.declarations?.length ?? 0) === 0 ? symbol : target;
  };
  const rawSymbolOf = (node: ts.Identifier): ts.Symbol | undefined =>
    ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
  // Each file's references by the symbol they name, indexed only when a reach first looks into that file, so a
  // run holds the files its tests reach rather than every file of the program.
  const indexes = new Map<ts.SourceFile, Map<ts.Symbol, ts.Identifier[]>>();
  const referencesIn = (sf: ts.SourceFile): Map<ts.Symbol, ts.Identifier[]> => {
    const known = indexes.get(sf);
    if (known !== undefined) return known;
    const built = new Map<ts.Symbol, ts.Identifier[]>();
    indexes.set(sf, built);
    if (sf.isDeclarationFile || !source.has(local(sf.fileName))) return built;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const raw = rawSymbolOf(node);
        if (raw !== undefined) {
          const found = unaliased(raw);
          const list = built.get(found);
          if (list === undefined) built.set(found, [node]);
          else list.push(node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return built;
  };
  const erased = (node: ts.Node): boolean =>
    ts.isTypeNode(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node);
  const within = (node: ts.Node, root: ts.Node): boolean => {
    for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent)
      if (current === root) return true;
    return false;
  };
  const statementOf = (node: ts.Node): ts.Node => {
    let current = node;
    for (let parent = current.parent; parent !== undefined; parent = current.parent) {
      if (
        ts.isBlock(parent) ||
        ts.isSourceFile(parent) ||
        ts.isModuleBlock(parent) ||
        ts.isCaseClause(parent) ||
        ts.isDefaultClause(parent) ||
        ts.isClassLike(parent) ||
        (ts.isArrowFunction(parent) && parent.body === current)
      )
        return current;
      current = parent;
    }
    return current;
  };
  const functionOf = (node: ts.Node): ts.SignatureDeclaration | undefined => {
    for (let current = node.parent; current !== undefined; current = current.parent)
      if (ts.isFunctionLike(current)) return current;
    return undefined;
  };
  const thisContainerOf = (node: ts.Node): ts.Node => {
    let current = node.parent;
    while (
      current !== undefined &&
      !ts.isSourceFile(current) &&
      !ts.isClassLike(current) &&
      !ts.isPropertyDeclaration(current) &&
      !ts.isClassStaticBlockDeclaration(current) &&
      !(ts.isFunctionLike(current) && !ts.isArrowFunction(current))
    )
      current = current.parent;
    return current ?? node.getSourceFile();
  };
  const nameSymbolOf = (fn: ts.SignatureDeclaration): ts.Symbol | undefined => {
    const name =
      fn.name !== undefined
        ? fn.name
        : ts.isVariableDeclaration(fn.parent) ||
            ts.isPropertyAssignment(fn.parent) ||
            ts.isPropertyDeclaration(fn.parent)
          ? fn.parent.name
          : undefined;
    return name === undefined ? undefined : checker.getSymbolAtLocation(name);
  };
  const referenceType = (type: ts.Type): type is ts.TypeReference =>
    "objectFlags" in type &&
    typeof type.objectFlags === "number" &&
    (type.objectFlags & ts.ObjectFlags.Reference) !== 0;
  const readonlyProperty = (property: ts.Symbol): boolean =>
    property.declarations?.some(
      (node) => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Readonly) !== 0,
    ) === true;
  // Whether no holder of the value can change what it contains; a callable with no properties is one.
  const immutable = (type: ts.Type, seen = new Set<ts.Type>()): boolean => {
    if (seen.has(type)) return true;
    seen.add(type);
    if (
      (type.flags &
        (ts.TypeFlags.StringLike |
          ts.TypeFlags.NumberLike |
          ts.TypeFlags.BooleanLike |
          ts.TypeFlags.BigIntLike |
          ts.TypeFlags.EnumLike |
          ts.TypeFlags.ESSymbolLike |
          ts.TypeFlags.Undefined |
          ts.TypeFlags.Null |
          ts.TypeFlags.Void |
          ts.TypeFlags.Never)) !==
      0
    )
      return true;
    if (type.isUnionOrIntersection()) return type.types.every((part) => immutable(part, seen));
    if ((type.flags & ts.TypeFlags.Object) === 0) return false;
    if (type.getConstructSignatures().length > 0 || checker.isArrayType(type)) return false;
    if (type.symbol?.name === "ReadonlyArray" || checker.isTupleType(type)) {
      if (!referenceType(type)) return false;
      const target = type.target;
      if (checker.isTupleType(type) && !("readonly" in target && target.readonly === true))
        return false;
      return checker.getTypeArguments(type).every((argument) => immutable(argument, seen));
    }
    return type
      .getProperties()
      .every(
        (property) =>
          readonlyProperty(property) && immutable(checker.getTypeOfSymbol(property), seen),
      );
  };
  // One piece of code, or every statement that can change one mutable binding, and where it leads.
  type Piece = {
    readonly edges: Key[];
    readonly whole: Set<string>;
    readonly read: Set<string>;
  };
  const empty = (): Piece => ({
    edges: [],
    whole: new Set(),
    read: new Set(),
  });
  const pieces = new Map<Key, Piece>();
  const resultKeys = new Map<ts.Symbol, Results>();
  const resultsOf = (symbol: ts.Symbol): Results => {
    let key = resultKeys.get(symbol);
    if (key === undefined) {
      key = { results: symbol };
      resultKeys.set(symbol, key);
    }
    return key;
  };
  // Where a declaration's value comes from: the code to follow, a parameter, or a whole file.
  const reach = (declaration: ts.Node, piece: Piece): void => {
    let target: ts.Node = declaration;
    while (
      ts.isBindingElement(target) ||
      ts.isObjectBindingPattern(target) ||
      ts.isArrayBindingPattern(target)
    )
      target = target.parent;
    if (target.getSourceFile().isDeclarationFile) return;
    if (ts.isParameter(target)) {
      // What the enclosing code writes into a mutable argument is held too.
      piece.edges.push(...bindingSymbols(target.name));
      return;
    }
    if (ts.isSourceFile(target)) {
      piece.whole.add(local(target.fileName));
      return;
    }
    if (
      ts.isInterfaceDeclaration(target) ||
      ts.isTypeAliasDeclaration(target) ||
      ts.isTypeParameterDeclaration(target)
    )
      return;
    if (ts.isVariableDeclaration(target)) {
      const list = target.parent;
      if (ts.isCatchClause(list)) {
        piece.edges.push(list.parent);
        return;
      }
      if (ts.isForOfStatement(list.parent) || ts.isForInStatement(list.parent)) {
        piece.edges.push(list.parent);
        return;
      }
      piece.edges.push(target, ...bindingSymbols(target.name));
      return;
    }
    if (
      ts.isFunctionLike(target) ||
      ts.isClassLike(target) ||
      ts.isEnumDeclaration(target) ||
      ts.isModuleDeclaration(target) ||
      ts.isPropertyDeclaration(target) ||
      ts.isPropertyAssignment(target) ||
      ts.isShorthandPropertyAssignment(target) ||
      ts.isExportAssignment(target) ||
      ts.isEnumMember(target)
    ) {
      piece.edges.push(target);
      return;
    }
    piece.edges.push(statementOf(target));
  };
  const chainTop = (node: ts.Node): ts.Node => {
    let current = node;
    for (let parent = current.parent; parent !== undefined; parent = current.parent) {
      if (
        ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === current) ||
        ts.isNonNullExpression(parent) ||
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isTypeAssertionExpression(parent)
      )
        current = parent;
      else break;
    }
    return current;
  };
  // The binding whose value an access chain starts from.
  const holderOf = (expression: ts.Node): ts.Symbol | undefined => {
    let current = expression;
    while (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current)
    )
      current = current.expression;
    if (!ts.isIdentifier(current)) return undefined;
    const raw = rawSymbolOf(current);
    return raw === undefined ? undefined : unaliased(raw);
  };
  const assignment = (node: ts.Node): node is ts.BinaryExpression =>
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  const bindingSymbols = (name: ts.BindingName): ts.Symbol[] =>
    namesOf(name).flatMap((identifier) => {
      const symbol = checker.getSymbolAtLocation(identifier);
      return symbol === undefined ? [] : [symbol];
    });
  // Where a value an expression holds can be changed, or copied to another holder that can change it.
  const flow = (node: ts.Node, piece: Piece, seen: Set<ts.Node>): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const top = chainTop(node);
    const parent = top.parent;
    const file = local(top.getSourceFile().fileName);
    if (parent === undefined) return;
    if (assignment(parent)) {
      if (within(top, parent.left)) piece.edges.push(parent.right);
      else {
        const holder = holderOf(parent.left);
        if (holder !== undefined) piece.edges.push(holder);
        else if (!ts.isIdentifier(parent.left)) piece.edges.push(parent.left);
        flow(parent, piece, seen);
      }
      return;
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      const callArguments = parent.arguments ?? [];
      if (parent.expression === top) {
        // A method called on the value may keep what it is given.
        if (top !== node) for (const argument of callArguments) piece.edges.push(argument);
        return;
      }
      const position = callArguments.findIndex((argument) => argument === top);
      if (position < 0) return;
      const declaration = checker.getResolvedSignature(parent)?.getDeclaration();
      const parameters =
        declaration !== undefined &&
        ts.isFunctionLike(declaration) &&
        !declaration.getSourceFile().isDeclarationFile
          ? declaration.parameters
          : undefined;
      const parameter = parameters?.[Math.min(position, parameters.length - 1)];
      if (parameter !== undefined) {
        piece.edges.push(...bindingSymbols(parameter.name));
      }
      else {
        // A library call may copy the value into any other argument or its receiver, and return it.
        for (const other of callArguments)
          if (other !== top) {
            piece.edges.push(other);
            const holder = holderOf(other);
            if (holder !== undefined) piece.edges.push(holder);
          }
        if (ts.isPropertyAccessExpression(parent.expression)) {
          const holder = holderOf(parent.expression.expression);
          if (holder !== undefined) piece.edges.push(holder);
        }
        flow(parent, piece, seen);
      }
      return;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === top) {
      piece.edges.push(...bindingSymbols(parent.name));
      return;
    }
    if (
      (ts.isPropertyAssignment(parent) && parent.initializer === top) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isSpreadAssignment(parent)
    ) {
      flow(parent.parent, piece, seen);
      return;
    }
    if (ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent)) {
      flow(parent, piece, seen);
      return;
    }
    if (
      ts.isConditionalExpression(parent)
        ? parent.condition !== top
        : ts.isBinaryExpression(parent)
          ? [
              ts.SyntaxKind.BarBarToken,
              ts.SyntaxKind.AmpersandAmpersandToken,
              ts.SyntaxKind.QuestionQuestionToken,
              ts.SyntaxKind.CommaToken,
            ].includes(parent.operatorToken.kind)
          : ts.isAwaitExpression(parent) || ts.isYieldExpression(parent)
    ) {
      flow(parent, piece, seen);
      return;
    }
    if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === top)) {
      const fn = functionOf(top);
      const named = fn === undefined ? undefined : nameSymbolOf(fn);
      if (named !== undefined) piece.edges.push(resultsOf(named));
      else if (
        fn !== undefined &&
        (ts.isCallExpression(fn.parent) || ts.isNewExpression(fn.parent)) &&
        fn.parent.expression !== fn
      )
        // A callback's results go to the call it is handed to.
        flow(fn.parent, piece, seen);
      else piece.whole.add(file);
      return;
    }
    if (ts.isForOfStatement(parent) && parent.expression === top) {
      const initializer = parent.initializer;
      if (ts.isVariableDeclarationList(initializer))
        for (const declaration of initializer.declarations)
          piece.edges.push(...bindingSymbols(declaration.name));
      return;
    }
    if (ts.isPropertyDeclaration(parent) && parent.initializer === top) {
      piece.edges.push(parent.parent);
      return;
    }
    if (ts.isExportAssignment(parent)) {
      const module = checker.getSymbolAtLocation(top.getSourceFile());
      const exported =
        module === undefined ? undefined : checker.tryGetMemberInModuleExports("default", module);
      if (exported !== undefined) piece.edges.push(exported);
      else piece.whole.add(file);
    }
  };
  // Only references in the binding's own module are followed back: those are the writes that module's
  // importers reach too. Another module that writes into it is checked where it passes a handle or a
  // callable, and what a binding holds from elsewhere is charged by its declared type.
  const homeReferences = (symbol: ts.Symbol, piece: Piece): readonly ts.Identifier[] =>
    [...new Set((symbol.declarations ?? []).map((node) => node.getSourceFile()))].flatMap((home) => {
      if (!home.isDeclarationFile && source.has(local(home.fileName))) piece.read.add(local(home.fileName));
      return referencesIn(home).get(symbol) ?? [];
    });
  // A binding that only ever holds primitives can't hold authority, however it is reassigned.
  const inert = (type: ts.Type): boolean =>
    type.isUnionOrIntersection()
      ? type.types.every(inert)
      : (type.flags &
          (ts.TypeFlags.StringLike |
            ts.TypeFlags.NumberLike |
            ts.TypeFlags.BooleanLike |
            ts.TypeFlags.BigIntLike |
            ts.TypeFlags.EnumLike |
            ts.TypeFlags.ESSymbolLike |
            ts.TypeFlags.Undefined |
            ts.TypeFlags.Null |
            ts.TypeFlags.Void |
            ts.TypeFlags.Never)) !==
        0;
  // Whether what a binding holds can change: a host or package value is a fact where it is used, and a
  // constant holds what its initializer made unless its value can be changed through it.
  const changeable = (symbol: ts.Symbol): boolean => {
    const declarations = (symbol.declarations ?? []).filter(
      (declaration) => !declaration.getSourceFile().isDeclarationFile,
    );
    if (declarations.length === 0) return false;
    return declarations.some((declaration) => {
      const type = checker.getTypeAtLocation(declaration);
      if (inert(type)) return false;
      let binding: ts.Node = declaration;
      while (
        ts.isBindingElement(binding) ||
        ts.isObjectBindingPattern(binding) ||
        ts.isArrayBindingPattern(binding)
      )
        binding = binding.parent;
      return !(
        ts.isVariableDeclaration(binding) &&
        ts.isVariableDeclarationList(binding.parent) &&
        (binding.parent.flags & ts.NodeFlags.Const) !== 0 &&
        immutable(type)
      );
    });
  };
  // Every place that can change or copy a mutable binding's value.
  const changes = (symbol: ts.Symbol): Piece => {
    const piece = empty();
    if (!changeable(symbol)) return piece;
    const seen = new Set<ts.Node>();
    for (const reference of homeReferences(symbol, piece)) flow(reference, piece, seen);
    return piece;
  };
  // Where a function's result goes: each call is a holder of what it returns.
  const results = (symbol: ts.Symbol): Piece => {
    const piece = empty();
    if (!(symbol.declarations ?? []).some((node) => !node.getSourceFile().isDeclarationFile))
      return piece;
    const seen = new Set<ts.Node>();
    for (const reference of homeReferences(symbol, piece)) {
      const top = chainTop(reference);
      if (ts.isCallExpression(top.parent) && top.parent.expression === top)
        flow(top.parent, piece, seen);
      else if (!("name" in top.parent && top.parent.name === top))
        // Handed on as a value, its results go wherever it is called.
        piece.edges.push(statementOf(reference));
    }
    return piece;
  };
  const code = (root: ts.Node): Piece => {
    const piece = empty();
    const sf = root.getSourceFile();
    if (!source.has(local(sf.fileName))) {
      piece.whole.add(local(sf.fileName));
      return piece;
    }
    piece.read.add(local(sf.fileName));
    const visit = (node: ts.Node): void => {
      if (erased(node)) return;
      if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
        // `this` is the class or object literal that holds the method; any other `this` is dynamic.
        const container = thisContainerOf(node);
        if (!within(container, root)) {
          if (ts.isClassLike(container)) piece.edges.push(container);
          else if (ts.isClassLike(container.parent)) piece.edges.push(container.parent);
          else if (ts.isObjectLiteralExpression(container.parent)) piece.edges.push(container.parent);
          else piece.whole.add(local(sf.fileName));
        }
        return;
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0];
        if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
          const target = importTarget(specifier.text, sf.fileName);
          if (target !== null) piece.whole.add(target);
        }
      }
      if (ts.isIdentifier(node)) {
        const raw = rawSymbolOf(node);
        if (
          raw !== undefined &&
          !raw.declarations?.some((declaration) => ts.getNameOfDeclaration(declaration) === node)
        ) {
          const symbol = unaliased(raw);
          const property =
            (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
            (ts.isQualifiedName(node.parent) && node.parent.right === node);
          const declarations = symbol.declarations ?? [];
          if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) piece.whole.add(local(sf.fileName));
          else if (!declarations.some((declaration) => within(declaration, root))) {
            const runtime = declarations.filter(
              (declaration) => !declaration.getSourceFile().isDeclarationFile,
            );
            if (
              runtime.length > 0 &&
              !property ||
              runtime.some(
                (declaration) =>
                  !ts.isPropertySignature(declaration) && !ts.isMethodSignature(declaration),
              )
            )
              for (const declaration of runtime) reach(declaration, piece);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
    return piece;
  };
  const pieceOf = (key: Key): Piece => {
    let piece = pieces.get(key);
    if (piece === undefined) {
      piece = isResults(key) ? results(key.results) : isSymbol(key) ? changes(key) : code(key);
      pieces.set(key, piece);
    }
    return piece;
  };
  // Everything a piece leads to, as one set of item ids. A cycle of pieces shares one set.
  const items = new Map<string, number>();
  const values: { readonly kind: "reached" | "whole" | "declaration" | "read"; readonly name: string }[] = [];
  const bit = (key: string, value: (typeof values)[number]): bigint => {
    let id = items.get(key);
    if (id === undefined) {
      id = values.length;
      items.set(key, id);
      values.push(value);
    }
    return 1n << BigInt(id);
  };
  const own = (key: Key, piece: Piece): bigint => {
    let bits = 0n;
    if (!isResults(key) && !isSymbol(key)) {
      const file = local(key.getSourceFile().fileName);
      bits |= bit(`r:${file}`, { kind: "reached", name: file });
      for (const name of topLevelNames(key))
        bits |= bit(`d:${file}:${name}`, { kind: "declaration", name: `${file}\u0000${name}` });
    }
    for (const file of piece.whole) bits |= bit(`w:${file}`, { kind: "whole", name: file });
    for (const file of piece.read) bits |= bit(`t:${file}`, { kind: "read", name: file });
    return bits;
  };
  const summaries = new Map<Key, bigint>();
  const summarize = (start: Key): bigint => {
    const done = summaries.get(start);
    if (done !== undefined) return done;
    const order = new Map<Key, number>();
    const low = new Map<Key, number>();
    const component: Key[] = [];
    const open = new Set<Key>();
    const gathered = new Map<Key, bigint>();
    const frames: { readonly key: Key; readonly edges: readonly Key[]; next: number }[] = [];
    const enter = (key: Key): void => {
      order.set(key, order.size);
      low.set(key, order.size - 1);
      component.push(key);
      open.add(key);
      const piece = pieceOf(key);
      gathered.set(key, own(key, piece));
      frames.push({ key, edges: piece.edges, next: 0 });
    };
    enter(start);
    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      const edge = frame.edges[frame.next];
      if (edge !== undefined) {
        frame.next++;
        const finished = summaries.get(edge);
        if (finished !== undefined)
          gathered.set(frame.key, (gathered.get(frame.key) ?? 0n) | finished);
        else if (!order.has(edge)) enter(edge);
        else if (open.has(edge))
          low.set(frame.key, Math.min(low.get(frame.key) ?? 0, order.get(edge) ?? 0));
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (low.get(frame.key) === order.get(frame.key)) {
        let bits = 0n;
        const members: Key[] = [];
        for (let member = component.pop(); member !== undefined; member = component.pop()) {
          open.delete(member);
          members.push(member);
          bits |= gathered.get(member) ?? 0n;
          if (member === frame.key) break;
        }
        for (const member of members) summaries.set(member, bits);
        if (parent !== undefined)
          gathered.set(parent.key, (gathered.get(parent.key) ?? 0n) | bits);
      } else if (parent !== undefined)
        low.set(parent.key, Math.min(low.get(parent.key) ?? 0, low.get(frame.key) ?? 0));
    }
    return summaries.get(start) ?? 0n;
  };
  return (argument) => {
    const bits = summarize(argument).toString(2);
    const reached = new Set<string>();
    const whole = new Set<string>();
    const declarations = new Set<string>();
    const read = new Set<string>();
    for (let index = 0; index < bits.length; index++) {
      if (bits[bits.length - 1 - index] !== "1") continue;
      const value = values[index];
      if (value?.kind === "reached") reached.add(value.name);
      else if (value?.kind === "whole") whole.add(value.name);
      else if (value?.kind === "declaration") declarations.add(value.name);
      else if (value?.kind === "read") read.add(value.name);
    }
    return {
      reached: [...reached].sort(),
      whole: [...whole].sort(),
      declarations: [...declarations].sort().map((key) => {
        const [file = "", name = ""] = key.split("\u0000");
        return { file, name };
      }),
      read: [...read].sort(),
    };
  };
}

// A piece is keyed by its code, by a binding whose changes it holds, or by a function whose results it holds.
type Results = { readonly results: ts.Symbol };
type Key = ts.Node | ts.Symbol | Results;

function isResults(key: Key): key is Results {
  return "results" in key;
}

function isSymbol(key: Key): key is ts.Symbol {
  return "flags" in key && "escapedName" in key;
}

function namesOf(name: ts.BindingName): ts.Identifier[] {
  return ts.isIdentifier(name) ? [name] : collectNames(name);
}

function collectNames(pattern: ts.BindingPattern): ts.Identifier[] {
  return pattern.elements.flatMap((element) =>
    ts.isOmittedExpression(element)
      ? []
      : ts.isIdentifier(element.name)
        ? [element.name]
        : collectNames(element.name),
  );
}
