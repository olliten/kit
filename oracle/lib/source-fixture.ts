import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

export function sourceFixture(
  files: Readonly<Record<string, string>>,
  config: Partial<KitConfig> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "kit-zone-boundary-"));
  try {
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
        },
        include: ["src/**/*.ts"],
      }),
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return readSnapshot(root, { ...DEFAULT_CONFIG, ...config });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
