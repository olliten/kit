import ts from "typescript";
import type { ProgramScope } from "../primitives/program-scope.js";
import { type FileScope, fileScope } from "./file-scope.js";

// What reads facts from a walk: each node, with whether it is runtime code, and each file once it is walked.
export interface FactRecorder {
  readonly visit?: (file: FileScope, node: ts.Node, runtime: boolean) => void;
  readonly end?: (file: FileScope) => void;
}

// One walk over every checked source file of a program visits each node once for every recorder; a node is
// runtime code unless it sits in a type, a type declaration or an import or export declaration.
export function factWalk({ program, local, source }: ProgramScope, recorders: readonly FactRecorder[]): void {
  for (const sf of program.getSourceFiles()) {
    const path = local(sf.fileName);
    if (!source.has(path)) continue;
    const file = fileScope(sf, path);
    const visit = (node: ts.Node): void => {
      let runtime = true;
      for (let parent: ts.Node | undefined = node; parent !== undefined; parent = parent.parent)
        if (
          ts.isTypeNode(parent) ||
          ts.isInterfaceDeclaration(parent) ||
          ts.isTypeAliasDeclaration(parent) ||
          ts.isImportDeclaration(parent) ||
          ts.isExportDeclaration(parent) ||
          (ts.isImportClause(parent) && parent.isTypeOnly)
        )
          runtime = false;
      for (const recorder of recorders) recorder.visit?.(file, node, runtime);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const recorder of recorders) recorder.end?.(file);
  }
}
