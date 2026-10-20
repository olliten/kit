import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import ts from "typescript";

// One host read as a cache replays it: the operation, its arguments and what came back, file text as its
// digest. A failed probe is a read too, so a file that appears where resolution looked is a change.
export interface CompilerRead {
  readonly operation:
    | "readFile"
    | "fileExists"
    | "directoryExists"
    | "getDirectories"
    | "realpath"
    | "readDirectory"
    | "getEnvironmentVariable";
  readonly arguments: readonly (string | number | readonly string[] | null)[];
  readonly result: string | boolean | readonly string[] | null | { readonly error: string };
}

interface WorkerHost {
  readonly types: readonly string[];
  readonly globals: readonly string[];
}

export interface CompilerWorkspace {
  workerHost(trace: CompilerRead[]): WorkerHost;
  load(
    path: string,
    trace: CompilerRead[],
  ): {
    readonly parsed: ts.ParsedCommandLine;
    readonly readError: ts.Diagnostic | undefined;
    readonly program: ts.Program;
  };
  resolve(
    specifier: string,
    containingFile: string,
    options: ts.CompilerOptions,
    trace: CompilerRead[],
    mode?: ts.ResolutionMode,
  ): ts.ResolvedModuleFull | undefined;
  reread(read: CompilerRead): CompilerRead;
}

type Argument = string | number | readonly string[] | undefined;

function recorded<A extends readonly Argument[], T>(
  trace: CompilerRead[],
  operation: CompilerRead["operation"],
  run: (...args: A) => T,
  result: (value: T) => CompilerRead["result"],
): (...args: A) => T {
  return (...args) => {
    const given = args.map((argument) => argument ?? null);
    try {
      const value = run(...args);
      trace.push({ operation, arguments: given, result: result(value) });
      return value;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
      trace.push({ operation, arguments: given, result: { error: code } });
      throw error;
    }
  };
}

const digest = (text: string | undefined): string | null =>
  text === undefined ? null : createHash("sha256").update(text).digest("hex");
const same = <T extends string | boolean>(value: T): T => value;
const names = (value: readonly string[]): readonly string[] => [...value];

// Every host read goes through one system per trace, so the compiler host, config parsing and module
// resolution record into the same trace.
function tracedSystem(trace: CompilerRead[]): ts.System {
  const sys = ts.sys;
  const realpath = sys.realpath;
  return {
    ...sys,
    readFile: recorded(
      trace,
      "readFile",
      (path: string, encoding?: string) => sys.readFile(path, encoding),
      digest,
    ),
    fileExists: recorded(trace, "fileExists", (path: string) => sys.fileExists(path), same),
    directoryExists: recorded(trace, "directoryExists", (path: string) => sys.directoryExists(path), same),
    getDirectories: recorded(trace, "getDirectories", (path: string) => sys.getDirectories(path), names),
    readDirectory: recorded(
      trace,
      "readDirectory",
      (
        path: string,
        extensions?: readonly string[],
        exclude?: readonly string[],
        include?: readonly string[],
        depth?: number,
      ) => sys.readDirectory(path, extensions, exclude, include, depth),
      names,
    ),
    ...(realpath === undefined
      ? {}
      : { realpath: recorded(trace, "realpath", (path: string) => realpath(path), same) }),
  };
}

// The public system type has no environment reads, so they are taken through a compiler host, as the
// compiler itself takes them.
const environment = ts.createCompilerHost({});
const environmentReader = (trace: CompilerRead[]) =>
  recorded(
    trace,
    "getEnvironmentVariable",
    (name: string) => environment.getEnvironmentVariable?.(name),
    (value) => value ?? null,
  );

const systems = new WeakMap<CompilerRead[], ts.System>();
function systemOf(trace: CompilerRead[]): ts.System {
  const known = systems.get(trace);
  if (known !== undefined) return known;
  const system = tracedSystem(trace);
  systems.set(trace, system);
  return system;
}

const text = (value: CompilerRead["arguments"][number] | undefined): string =>
  typeof value === "string" ? value : "";
const optionalText = (value: CompilerRead["arguments"][number] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;
const list = (value: CompilerRead["arguments"][number] | undefined): readonly string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
const count = (value: CompilerRead["arguments"][number] | undefined): number | undefined =>
  typeof value === "number" ? value : undefined;

let workerHostCache: { readonly text: string; readonly host: WorkerHost } | undefined;

export const compilerWorkspace: CompilerWorkspace = {
  workerHost(trace) {
    const path = join(dirname(ts.getDefaultLibFilePath({})), "lib.webworker.d.ts");
    const text = systemOf(trace).readFile(path);
    if (text === undefined) throw new Error("The compiler's worker host declarations are missing.");
    // Every snapshot traces the SDK read; only parsing its unchanged bytes is reused.
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
  load(path, trace) {
    const system = systemOf(trace);
    const read = ts.readConfigFile(path, (file) => system.readFile(file));
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, system, dirname(path), undefined, path);
    // The created host's own getSourceFile reads through the original system, so it is replaced.
    const host = {
      ...ts.createCompilerHost(parsed.options),
      readFile: system.readFile,
      fileExists: system.fileExists,
      directoryExists: system.directoryExists,
      getDirectories: system.getDirectories,
      readDirectory: system.readDirectory,
      getEnvironmentVariable: environmentReader(trace),
      ...(system.realpath === undefined ? {} : { realpath: system.realpath }),
      getSourceFile: (
        fileName: string,
        languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
        onError?: (message: string) => void,
      ) => {
        let source: string | undefined;
        try {
          source = system.readFile(fileName);
        } catch (error) {
          onError?.(error instanceof Error ? error.message : String(error));
          source = "";
        }
        return source === undefined
          ? undefined
          : ts.createSourceFile(fileName, source, languageVersionOrOptions);
      },
      useSourceOfProjectReferenceRedirect: () => true,
    };
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      host,
      ...(parsed.projectReferences === undefined ? {} : { projectReferences: parsed.projectReferences }),
    });
    return { parsed, readError: read.error, program };
  },
  resolve: (specifier, containingFile, options, trace, mode) =>
    ts.resolveModuleName(specifier, containingFile, options, systemOf(trace), undefined, undefined, mode)
      .resolvedModule,
  reread(read) {
    const again: CompilerRead[] = [];
    const system = tracedSystem(again);
    const [first, second, third, fourth, fifth] = read.arguments;
    try {
      if (read.operation === "readFile") system.readFile(text(first), optionalText(second));
      else if (read.operation === "fileExists") system.fileExists(text(first));
      else if (read.operation === "directoryExists") system.directoryExists(text(first));
      else if (read.operation === "getDirectories") system.getDirectories(text(first));
      else if (read.operation === "realpath") system.realpath?.(text(first));
      else if (read.operation === "readDirectory")
        system.readDirectory(text(first), list(second), list(third), list(fourth), count(fifth));
      else environmentReader(again)(text(first));
    } catch {
      // A thrown read is recorded with its error code, which is what gets compared.
    }
    return again[0] ?? read;
  },
};
