import type { CompilerOptions } from "typescript";
import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import { readSnapshot } from "../../../src/substrate/compositions/read-snapshot.js";
import { temporaryProjects } from "../adapters/temporary-project.js";

export function sourceFixture(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
  compilerOptions: Pick<CompilerOptions, "paths" | "skipLibCheck"> = {},
) {
  const project = temporaryProjects.open("kit-zone-boundary-");
  try {
    const declared = config.srcRoot ?? DEFAULT_CONFIG.srcRoot;
    const roots = typeof declared === "string" ? [declared] : declared;
    const inputs = {
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
        include: roots.map((path) => `${path}/**/*.ts`),
      }),
      ...files,
    };
    project.write(inputs);
    return readSnapshot(project.root, { ...DEFAULT_CONFIG, ...config });
  } finally {
    project.dispose();
  }
}
