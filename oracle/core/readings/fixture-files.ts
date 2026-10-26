import type { CompilerOptions } from "typescript";
import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";

// The files of a compiler fixture: a strict project over the declared code roots and legacy locations, with
// the given sources.
export function fixtureFiles(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
  compilerOptions: Pick<CompilerOptions, "paths" | "skipLibCheck"> = {},
): Record<string, string> {
  const declared = config.srcRoot ?? DEFAULT_CONFIG.srcRoot;
  const roots = typeof declared === "string" ? [declared] : declared;
  return {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM"],
        types: [],
        strict: true,
        noEmit: true,
        declaration: true,
        isolatedDeclarations: true,
        ...compilerOptions,
      },
      include: [
        ...roots.map((path) => `${path}/**/*.ts`),
        ...(config.layout?.legacy ?? []).map((path) => (/\.[mc]?[jt]sx?$/.test(path) ? path : `${path}/**/*.ts`)),
      ],
    }),
    ...files,
  };
}
