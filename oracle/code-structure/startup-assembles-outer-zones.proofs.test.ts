import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/compositions/capability-check.js";
import { claimProofBinder } from "../../src/core/readings/claim-proof-binder.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const proof = "oracle/count/increments.test.ts";
const reading = "src/core/readings/increment.ts";
const driver = "oracle/substrate/compositions/driver.ts";
const files = {
  [reading]: "export function increment(n: number): number { return n + 1; }\n",
  [driver]: "export function drive(read: (n: number) => number): number { return read(1); }\n",
  [proof]:
    "import { increment } from '../../src/core/readings/increment.js';\n" +
    "import { drive } from '../substrate/compositions/driver.js';\n" +
    "if (drive(increment) !== 2) throw new Error('Mismatch');\n",
  "spec/count.md":
    "# Count\n\nCounting.\n\n## Increment\n\n- A count increments. · {#increments}\n",
};

function inspect(
  extra: Readonly<Record<string, string>> = {},
  config: Partial<KitConfig> = {},
  compilerOptions: Parameters<typeof sourceFixture>[2] = {},
) {
  const snapshot = sourceFixture(
    { ...files, ...extra },
    {
      srcRoot: ["src", "oracle"],
      exceptions: [proof],
      ...config,
    },
    compilerOptions,
  );
  return { snapshot, result: capabilityCheck(snapshot) };
}

test("an exact declared proof is checked as an entrypoint without losing its topic identity", () => {
  const { snapshot, result } = inspect();
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  expect(snapshot.files.find((file) => file.path === proof)?.type).toBe("test");
  expect(claimProofBinder(snapshot)).toEqual([]);
  expect(result.requirements.map((row) => row.path)).toContain(proof);
  expect(result.findings).toEqual([]);
});

test("raw clock access in a declared proof's callback is still checked", () => {
  const { result } = inspect({
    [proof]: "const callback = (): number => Date.now(); callback();\n",
  });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      debtKey: `R1:raw-primitive:${proof}:clock`,
      category: "placed-violation",
      blocking: true,
    }),
  );
});

test("a declared proof cannot hide its own compiler errors", () => {
  const { result } = inspect({ [proof]: "const n: number = 'wrong'; void n;\n" });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path: proof,
      debtKey: expect.stringContaining(`R1:compiler:${proof}:2322:`),
      blocking: true,
    }),
  );
});

test.each(["runtime", "type"])(
  "modules cannot import a proof entrypoint through a %s edge",
  (kind) => {
    const { result } = inspect({
      [proof]:
        files[proof] +
        "export interface Data { readonly n: number; }\nexport const data: number = 1;\n",
      [driver]:
        kind === "type"
          ? "import type { Data } from '../../count/increments.test.js'; export function drive(read: (n: number) => number): number { const data: Data = { n: 1 }; return read(data.n); }\n"
          : "import { data } from '../../count/increments.test.js'; export function drive(read: (n: number) => number): number { return read(data); }\n",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        path: driver,
        debtKey: `R2:startup-import:${driver}:${proof}`,
        blocking: true,
      }),
    );
  },
);

test("an entrypoint declaration grants no raw authority to its driver", () => {
  const { result } = inspect({
    [driver]:
      "export function drive(read: (n: number) => number): number { return read(Date.now()); }\n",
  });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path: driver,
      debtKey: `R1:raw-primitive:${driver}:clock`,
      blocking: true,
    }),
  );
});

test.each([
  { name: "pure", callback: "() => 7" },
  { name: "clock-capturing", callback: "() => clock()" },
])(
  "core takes no callback, whatever a proof hands it: $name",
  ({ callback }) => {
    const { snapshot, result } = inspect(
      {
        "oracle/substrate/adapters/clock.ts":
          "export function clock(): number { return Date.now(); }\n",
        "src/core/compositions/run.ts":
          "export function run(action: () => number): number { return action(); }\n",
        [proof]:
          "import { clock } from '../substrate/adapters/clock.js';\n" +
          "import { run } from '../../src/core/compositions/run.js';\n" +
          `clock(); run(${callback});\n`,
      },
      {
        adapters: [
          {
            module: "oracle/substrate/adapters/clock",
            export: "clock",
            capability: "clock.read",
            kind: "external",
            zones: ["substrate"],
            primitives: ["clock"],
          },
        ],
      },
    );
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        debtKey: "R1:takes-behaviour:src/core/compositions/run.ts:run",
        category: "placed-violation",
        blocking: true,
      }),
    ]);
  },
);

test("a test suffix cannot turn a zoned module into an entrypoint", () => {
  const path = "oracle/core/readings/value.test.ts";
  const { result } = inspect({ [path]: "void 0;\n" }, { exceptions: [path] });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path,
      debtKey: `R2:startup-placement:${path}:${path}`,
      category: "checker-limit",
      blocking: true,
    }),
  );
});

test("an imported undeclared test file remains an unresolved boundary", () => {
  const helper = "oracle/count/helper.test.ts";
  const { result } = inspect({
    [proof]: "import { run } from './helper.test.js'; run();\n",
    [helper]: "export function run(): number { return Date.now(); }\n",
  });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path: proof,
      debtKey: `R1:external-boundary:${proof}:./helper.test.js`,
      blocking: true,
    }),
  );
});

test("real Vitest registration stays an unresolved boundary until its framework contract is declared", () => {
  const { result, snapshot } = inspect(
    {
      "package.json": JSON.stringify({ type: "module" }),
      [proof]:
        "import { test, expect } from 'vitest'; test('increments', () => { expect(1 + 1).toBe(2); });\n",
    },
    {},
    {
      skipLibCheck: true,
      paths: {
        vitest: [
          fileURLToPath(new URL("../../node_modules/vitest/dist/index.d.ts", import.meta.url)),
        ],
      },
    },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      path: proof,
      debtKey: `R1:external-boundary:${proof}:vitest`,
      category: "checker-limit",
      blocking: true,
    }),
  );
});
