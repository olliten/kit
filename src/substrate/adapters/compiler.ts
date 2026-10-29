import { dirname, join } from "node:path";
import ts from "typescript";
import type { FunctionSpan } from "../../core/primitives/function-span.js";

interface WorkerHost {
  readonly types: readonly string[];
  readonly globals: readonly string[];
}

export interface CompilerWorkspace {
  workerHost(): WorkerHost;
  load(path: string): {
    readonly parsed: ts.ParsedCommandLine;
    readonly readError: ts.Diagnostic | undefined;
    readonly program: ts.Program;
    // Every compiler config the project read, the one named and each it extends, with its text.
    readonly configs: readonly (readonly [string, string])[];
  };
  resolve(
    specifier: string,
    containingFile: string,
    options: ts.CompilerOptions,
    mode?: ts.ResolutionMode,
  ): ts.ResolvedModuleFull | undefined;
  // The functions of one file no other function holds, in source order: any function, method, accessor or
  // constructor with a body.
  outermostFunctions(path: string, text: string): FunctionSpan[];
}

let workerHostCache: { readonly text: string; readonly host: WorkerHost } | undefined;

// A declaration file parses the same whenever its text and parse options are the same, and the standard and
// installed declarations are most of every program, so their parse is kept for the next program. The text is
// still read each time, so a changed file parses again.
const declarations = new Map<string, { readonly text: string; readonly file: ts.SourceFile }>();
function sourceOf(
  fileName: string,
  text: string,
  options: ts.ScriptTarget | ts.CreateSourceFileOptions,
): ts.SourceFile {
  if (!/\.d\.[mc]?ts$/.test(fileName)) return ts.createSourceFile(fileName, text, options);
  const key = `${fileName}\u0000${JSON.stringify(options)}`;
  const known = declarations.get(key);
  if (known !== undefined && known.text === text) return known.file;
  const file = ts.createSourceFile(fileName, text, options);
  declarations.set(key, { text, file });
  return file;
}

export const compilerWorkspace: CompilerWorkspace = {
  outermostFunctions(path, text) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const spans: FunctionSpan[] = [];
    const line = (offset: number): number => sf.getLineAndCharacterOfPosition(offset).line + 1;
    const visit = (node: ts.Node): void => {
      const body =
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
          ? node.body
          : undefined;
      if (body !== undefined) {
        spans.push({ body: [body.getStart(sf), body.getEnd()], lines: [line(node.getStart(sf)), line(node.getEnd())] });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return spans;
  },
  workerHost() {
    const path = join(dirname(ts.getDefaultLibFilePath({})), "lib.webworker.d.ts");
    const text = ts.sys.readFile(path);
    if (text === undefined) throw new Error("The compiler's worker host declarations are missing.");
    // The SDK file is read for every snapshot; only parsing its unchanged bytes is reused.
    if (workerHostCache?.text === text) return workerHostCache.host;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
    const host: WorkerHost = {
      types: source.statements.flatMap((node) =>
        (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined
          ? [node.name.text]
          : []),
      globals: source.statements.flatMap((node) =>
        ts.isVariableStatement(node)
          ? node.declarationList.declarations.flatMap((item) =>
              ts.isIdentifier(item.name) ? [item.name.text] : [])
          : ts.isFunctionDeclaration(node) && node.name !== undefined ? [node.name.text] : []),
    };
    workerHostCache = { text, host };
    return host;
  },
  load(path) {
    const configs: [string, string][] = [];
    const readConfig = (file: string): string | undefined => {
      const text = ts.sys.readFile(file);
      configs.push([file, text ?? ""]);
      return text;
    };
    const read = ts.readConfigFile(path, readConfig);
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, { ...ts.sys, readFile: readConfig }, dirname(path), undefined, path);
    // The created host parses every file anew, so its getSourceFile is replaced by one that keeps declarations.
    const host = {
      ...ts.createCompilerHost(parsed.options),
      getSourceFile: (
        fileName: string,
        languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
        onError?: (message: string) => void,
      ) => {
        let source: string | undefined;
        try {
          source = ts.sys.readFile(fileName);
        } catch (error) {
          onError?.(error instanceof Error ? error.message : String(error));
          source = "";
        }
        return source === undefined ? undefined : sourceOf(fileName, source, languageVersionOrOptions);
      },
      useSourceOfProjectReferenceRedirect: () => true,
    };
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      host,
      ...(parsed.projectReferences === undefined ? {} : { projectReferences: parsed.projectReferences }),
    });
    return { parsed, readError: read.error, program, configs };
  },
  resolve: (specifier, containingFile, options, mode) =>
    ts.resolveModuleName(specifier, containingFile, options, ts.sys, undefined, undefined, mode)
      .resolvedModule,
};
