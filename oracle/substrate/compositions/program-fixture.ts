import { join, relative, sep } from "node:path";
import ts, { type CompilerOptions } from "typescript";
import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import { type CompilerRead, compilerWorkspace } from "../../../src/substrate/adapters/compiler.js";
import type { ProgramScope } from "../../../src/substrate/primitives/program-scope.js";
import { fixtureFiles } from "../../core/readings/fixture-files.js";
import { temporaryProjects } from "../adapters/temporary-project.js";

// What a recorder needs from a compiled fixture, without reading a whole snapshot: the program scope, the
// globals only a window host has, the importer's resolution of a specifier and the ambient module homes.
export interface ProgramFixture {
  readonly scope: ProgramScope;
  readonly workerGlobals: ReadonlySet<string>;
  readonly importTarget: (specifier: string, containingFile: string) => string | null;
  readonly ambientTargets: ReadonlyMap<string, { readonly declarationTarget: string }>;
  readonly files: readonly string[];
}

let last: { readonly key: string; readonly fixture: ProgramFixture } | undefined;

// A fixture's sources compiled in an owned temporary project, which is removed before this returns: every import
// is resolved while the project exists, so the program is held in memory only. Recorders of the same fixture
// share one compilation. A fixture that doesn't compile is an error, so a proof never reads facts from a broken
// program. Its checked sources are the code files and the test files the config declares as entrypoints.
export function openProgram(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
  compilerOptions: Pick<CompilerOptions, "paths" | "skipLibCheck"> = {},
): ProgramFixture {
  const key = JSON.stringify([files, config, compilerOptions]);
  if (last?.key === key) return last.fixture;
  const project = temporaryProjects.open("kit-program-");
  try {
    project.write(fixtureFiles(files, config, compilerOptions));
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
          /\.[mc]?[jt]sx?$/.test(path) &&
          !/\.d\.[mc]?ts$/.test(path) &&
          !path.startsWith("node_modules/") &&
          (!/\.test\./.test(path) || (config.exceptions ?? []).includes(path)),
      ),
    );
    const resolved = new Map<string, string | null>();
    for (const sf of program.getSourceFiles()) {
      if (!source.has(local(sf.fileName))) continue;
      const visit = (node: ts.Node): void => {
        const specifier =
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined
            ? node.moduleSpecifier
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : undefined;
        if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
          const target = compilerWorkspace.resolve(specifier.text, sf.fileName, parsed.options, trace);
          resolved.set(`${sf.fileName}\n${specifier.text}`, target === undefined ? null : local(target.resolvedFileName));
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    const host = compilerWorkspace.workerHost(trace);
    const fixture: ProgramFixture = {
      scope: { appRoot: project.root, config: { ...DEFAULT_CONFIG, ...config }, program, checker, local, source, workerTypes: new Set(host.types) },
      workerGlobals: new Set(host.globals),
      importTarget: (specifier, containingFile) => resolved.get(`${containingFile}\n${specifier}`) ?? null,
      ambientTargets: new Map(
        checker.getAmbientModules().flatMap((symbol) => {
          const homes = [...new Set((symbol.declarations ?? []).map((node) => local(node.getSourceFile().fileName)))];
          return homes.length === 1 && homes[0] !== undefined ? [[symbol.name, { declarationTarget: homes[0] }] as const] : [];
        }),
      ),
      files: [...source],
    };
    last = { key, fixture };
    return fixture;
  } finally {
    project.dispose();
  }
}
