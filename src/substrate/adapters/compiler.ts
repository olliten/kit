import { dirname } from "node:path";
import ts from "typescript";

export interface CompilerWorkspace {
  load(path: string): {
    readonly parsed: ts.ParsedCommandLine;
    readonly readError: ts.Diagnostic | undefined;
    readonly program: ts.Program;
  };
  resolve(
    specifier: string,
    containingFile: string,
    options: ts.CompilerOptions,
  ): ts.ResolvedModuleFull | undefined;
}

export const compilerWorkspace: CompilerWorkspace = {
  load(path) {
    const read = ts.readConfigFile(path, (file) => ts.sys.readFile(file));
    const parsed = ts.parseJsonConfigFileContent(
      read.config ?? {},
      ts.sys,
      dirname(path),
      undefined,
      path,
    );
    const host = {
      ...ts.createCompilerHost(parsed.options),
      useSourceOfProjectReferenceRedirect: () => true,
    };
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      host,
      ...(parsed.projectReferences === undefined
        ? {}
        : { projectReferences: parsed.projectReferences }),
    });
    return { parsed, readError: read.error, program };
  },
  resolve: (specifier, containingFile, options) =>
    ts.resolveModuleName(specifier, containingFile, options, ts.sys).resolvedModule,
};
