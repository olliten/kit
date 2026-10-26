// A small app the real reader extracts: a compiled project that imports a package, an `evidence/` folder the
// config ignores, and a package README the compiler never opens.
export const CACHE_APP: Readonly<Record<string, string>> = {
  "tsconfig.json":
    "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"lib\":[\"ES2022\"],\"strict\":true,\"noEmit\":true,\"skipLibCheck\":true},\"include\":[\"src/**/*.ts\"]}",
  "src/core/primitives/value.ts": "export const value = 7;\n",
  "src/core/readings/double.ts":
    'import type { Shape } from "a";\nimport { value } from "../primitives/value.js";\nexport const double = (shape: Shape): number => shape.n * value * 2;\n',
  "spec/terms.md": "# Terms\n\n- **value** — a number.\n",
  "spec/numbers.md": "# Numbers\n\nNumbers.\n\n## Values\n\n- A value doubles ({{double}}). · {#value-doubles}\n",
  "node_modules/a/package.json": "{\"name\":\"a\",\"version\":\"1.0.0\",\"types\":\"index.d.ts\"}",
  "node_modules/a/index.d.ts": "export interface Shape { readonly n: number; }\n",
  "node_modules/a/README.md": "# a\n",
  "evidence/read-cost/1.json": "{}\n",
};

// What the cache app's config adds to the defaults: the evidence folder it never reads.
export const CACHE_IGNORE: readonly string[] = ["evidence"];
