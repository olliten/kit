// A small app the real reader extracts: a project whose options extend a base, a reading that imports a package
// and a primitive, a reading taking a union of named types and holding two type errors, a reading whose return type is inferred
// and one that imports it, a file declaring a
// global, a test, an `evidence/` folder the config ignores, and a package
// README the compiler never opens.
export const SMALL_APP: Readonly<Record<string, string>> = {
  "config/base.json":
    "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"lib\":[\"ES2022\"],\"strict\":true,\"noEmit\":true,\"skipLibCheck\":true}}",
  "tsconfig.json": "{\"extends\":\"./config/base.json\",\"include\":[\"src/**/*.ts\",\"oracle/**/*.ts\"]}",
  "src/core/primitives/value.ts": "export const value = 7;\n",
  "src/core/primitives/limit.ts": "declare global {\n  var limit: number;\n}\nexport {};\n",
  "src/core/readings/double.ts":
    'import type { Shape } from "a";\nimport { value } from "../primitives/value.js";\nexport const double = (shape: Shape): number => shape.n * value * 2;\n',
  "src/core/readings/half.ts": "export const half = (n: number): number => n / 2;\n",
  "src/core/readings/third.ts": "export const third = (n: number) => n / 3;\n",
  "src/core/readings/thirds.ts": 'import { third } from "./third.js";\nexport const thirds = (n: number): number[] => [third(n), third(n * 2)];\n',
  "src/core/readings/pick.ts":
    'import type { Shape } from "a";\nexport interface Other {\n  readonly m: number;\n}\nexport const pick = (shape: Shape | Other): number => ("n" in shape ? shape.n : shape.m);\nexport const broken: number = "one";\nexport const worse: string = 2;\n',
  "oracle/numbers/value-doubles.test.ts":
    'import { double } from "../../src/core/readings/double.js";\nexport const doubled = double({ n: 1 });\n',
  "spec/terms.md": "# Terms\n\n- **value** — a number.\n",
  "spec/numbers.md": "# Numbers\n\nNumbers.\n\n## Values\n\n- A value doubles ({{double}}). · {#value-doubles}\n",
  "node_modules/a/package.json": "{\"name\":\"a\",\"version\":\"1.0.0\",\"types\":\"index.d.ts\"}",
  "node_modules/a/index.d.ts": "export interface Shape { readonly n: number; }\n",
  "node_modules/a/README.md": "# a\n",
  "evidence/read-cost/1.json": "{}\n",
};

// What the small app's config adds to the defaults: the evidence folder it never reads.
export const SMALL_IGNORE: readonly string[] = ["evidence"];
