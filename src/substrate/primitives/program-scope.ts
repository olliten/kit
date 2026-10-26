import type ts from "typescript";
import type { KitConfig } from "../../core/primitives/default-config.js";

// What every fact reader over one compiler program shares: the program and its checker, the app-relative path
// of a compiled file, the checked source files, the types a worker host also has, and the config.
export interface ProgramScope {
  readonly appRoot: string;
  readonly config: KitConfig;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly local: (file: string) => string;
  readonly source: ReadonlySet<string>;
  readonly workerTypes: ReadonlySet<string>;
}
