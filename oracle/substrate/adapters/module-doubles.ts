import { vi } from "vitest/dist/index.js";

export interface ProcessFixture {
  readonly argv?: readonly string[];
  readonly execArgv?: readonly string[];
  readonly nodeOptions?: string;
  readonly exitCode?: string | number | undefined;
}

export interface ModuleDoubles {
  replace(name: string, exports: Readonly<Record<string, unknown>>): void;
  configure(state: ProcessFixture): void;
  runtime(): { readonly execPath: string; readonly argv: readonly string[]; readonly execArgv: readonly string[]; readonly cwd: string; readonly exitCode: string | number | undefined };
  capture(): { readonly stdout: readonly string[]; readonly stderr: readonly string[] };
  restore(): void;
}

const original = {
  argv: process.argv,
  execArgv: process.execArgv,
  nodeOptions: process.env["NODE_OPTIONS"],
  exitCode: process.exitCode,
  stdout: process.stdout.write,
  stderr: process.stderr.write,
};
const replaced = new Set<string>();

// SDK replacements and process fixtures are native test-runner effects; their controls expose no Vitest handle.
export const moduleDoubles: ModuleDoubles = {
  replace(name, exports) {
    vi.doMock(name, () => exports);
    replaced.add(name);
  },
  configure(state) {
    if (state.argv !== undefined) process.argv = [...state.argv];
    if (state.execArgv !== undefined) process.execArgv = [...state.execArgv];
    if (state.nodeOptions !== undefined) process.env["NODE_OPTIONS"] = state.nodeOptions;
    if ("exitCode" in state) process.exitCode = state.exitCode;
  },
  runtime() {
    return { execPath: process.execPath, argv: [...process.argv], execArgv: [...process.execArgv], cwd: process.cwd(), exitCode: process.exitCode };
  },
  capture() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
    process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
    return { stdout, stderr };
  },
  restore() {
    for (const name of replaced) vi.doUnmock(name);
    replaced.clear();
    vi.resetModules();
    process.argv = original.argv;
    process.execArgv = original.execArgv;
    if (original.nodeOptions === undefined) delete process.env["NODE_OPTIONS"];
    else process.env["NODE_OPTIONS"] = original.nodeOptions;
    process.exitCode = original.exitCode;
    process.stdout.write = original.stdout;
    process.stderr.write = original.stderr;
  },
};
