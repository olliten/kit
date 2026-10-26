import { join, relative, sep } from "node:path";
import ts from "typescript";
import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import { type CompilerRead, compilerWorkspace } from "../../../src/substrate/adapters/compiler.js";
import type { ProgramScope } from "../../../src/substrate/primitives/program-scope.js";
import { fixtureFiles } from "../../core/readings/fixture-files.js";
import { type TemporaryProject, temporaryProjects } from "../adapters/temporary-project.js";

// What a recorder needs from a compiled fixture, without reading a whole snapshot: the program scope, the
// globals only a window host has, the importer's resolution of a specifier and the ambient module homes.
export interface ProgramFixture {
  readonly scope: ProgramScope;
  readonly workerGlobals: ReadonlySet<string>;
  readonly importTarget: (specifier: string, containingFile: string) => string | null;
  readonly ambientTargets: ReadonlyMap<string, { readonly declarationTarget: string }>;
  readonly files: readonly string[];
  dispose(): void;
}

// A fixture's sources compiled in an owned temporary project; a fixture that doesn't compile is an error, so a
// proof never reads facts from a broken program.
export function openProgram(files: Readonly<Record<string, string>>, config: Partial<KitConfig> = {}): ProgramFixture {
  const project: TemporaryProject = temporaryProjects.open("kit-program-");
  try {
    project.write(fixtureFiles(files, config));
    const trace: CompilerRead[] = [];
    const { parsed, program } = compilerWorkspace.load(join(project.root, "tsconfig.json"), trace);
    const errors = ts.getPreEmitDiagnostics(program).filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0)
      throw new Error(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("\n"));
    const checker = program.getTypeChecker();
    const local = (file: string): string => relative(project.root, file).split(sep).join("/");
    const source = new Set(
      Object.keys(files).filter(
        (path) =>
          /\.[mc]?[jt]sx?$/.test(path) && !/\.d\.[mc]?ts$/.test(path) && !/\.test\./.test(path) && !path.startsWith("node_modules/"),
      ),
    );
    const host = compilerWorkspace.workerHost(trace);
    return {
      scope: { appRoot: project.root, config: { ...DEFAULT_CONFIG, ...config }, program, checker, local, source, workerTypes: new Set(host.types) },
      workerGlobals: new Set(host.globals),
      importTarget: (specifier, containingFile) => {
        const resolved = compilerWorkspace.resolve(specifier, containingFile, parsed.options, trace);
        return resolved === undefined ? null : local(resolved.resolvedFileName);
      },
      ambientTargets: new Map(
        checker.getAmbientModules().flatMap((symbol) => {
          const homes = [...new Set((symbol.declarations ?? []).map((node) => local(node.getSourceFile().fileName)))];
          return homes.length === 1 && homes[0] !== undefined ? [[symbol.name, { declarationTarget: homes[0] }] as const] : [];
        }),
      ),
      files: [...source],
      dispose: () => project.dispose(),
    };
  } catch (error) {
    project.dispose();
    throw error;
  }
}
