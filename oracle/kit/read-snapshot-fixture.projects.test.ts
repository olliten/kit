import { expect, test } from "vitest";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const options = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
  types: [], strict: true, noEmit: true, skipLibCheck: true,
};

test("overlapping projects choose membership, nearest directory, tsconfig.json, then sibling name", () => {
  const snapshot = sourceFixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      ...options, paths: { "@chosen": ["./src/root.ts"] },
    }, include: ["src/**/*.ts"] }),
    "src/nested/tsconfig.json": JSON.stringify({ compilerOptions: {
      ...options, paths: { "@chosen": ["../default.ts"] },
    }, files: ["member.ts"] }),
    "src/nested/tsconfig.a.json": JSON.stringify({ compilerOptions: {
      ...options, paths: { "@chosen": ["../alpha.ts"] },
    }, files: ["member.ts", "sibling.ts"] }),
    "src/nested/tsconfig.z.json": JSON.stringify({ compilerOptions: {
      ...options, paths: { "@chosen": ["../zeta.ts"] },
    }, files: ["member.ts", "sibling.ts"] }),
    "src/root.ts": "export function chosen(): number { return 1; }\n",
    "src/default.ts": "export function chosen(): number { return 2; }\n",
    "src/alpha.ts": "export function chosen(): number { return 3; }\n",
    "src/zeta.ts": "export function chosen(): number { return 4; }\n",
    "src/nested/member.ts": "import { chosen } from '@chosen';\nchosen();\n",
    "src/nested/sibling.ts": "import { chosen } from '@chosen';\nchosen();\n",
    "src/nested/outsider.ts": "import { chosen } from '@chosen';\nchosen();\n",
  });
  expect(snapshot.imports).toEqual([
    { from: "src/nested/member.ts", to: "src/default.ts" },
    { from: "src/nested/outsider.ts", to: "src/root.ts" },
    { from: "src/nested/sibling.ts", to: "src/alpha.ts" },
  ]);
  expect(snapshot.sizes?.filter(({ file }) => file.startsWith("src/nested/"))).toEqual([
    { file: "src/nested/member.ts", statements: 2, calls: ["src/default.ts", "src/default.ts"] },
    { file: "src/nested/outsider.ts", statements: 2, calls: ["src/root.ts", "src/root.ts"] },
    { file: "src/nested/sibling.ts", statements: 2, calls: ["src/alpha.ts", "src/alpha.ts"] },
  ]);
  expect(snapshot.compiler?.projects.map(({ file, files }) => [file, files])).toEqual([
    ["src/nested/tsconfig.a.json", ["src/alpha.ts", "src/nested/member.ts", "src/nested/sibling.ts"]],
    ["src/nested/tsconfig.json", ["src/default.ts", "src/nested/member.ts"]],
    ["src/nested/tsconfig.z.json", ["src/zeta.ts", "src/nested/member.ts", "src/nested/sibling.ts"]],
    ["tsconfig.json", ["src/alpha.ts", "src/default.ts", "src/root.ts", "src/zeta.ts",
      "src/nested/member.ts", "src/nested/outsider.ts", "src/nested/sibling.ts"]],
  ]);
});

test("NodeNext static CommonJS and dynamic imports retain distinct conditional targets", () => {
  const snapshot = sourceFixture({
    "package.json": JSON.stringify({ type: "commonjs", imports: {
      "#chosen": { import: "./src/esm.ts", require: "./src/cjs.ts" },
    } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src/**/*"] }),
    "src/caller.cts": "import { chosen } from '#chosen';\nchosen();\nimport('#chosen');\n",
    "src/cjs.ts": "export function chosen(): number { return 1; }\n",
    "src/esm.ts": "export function chosen(): number { return 2; }\n",
  });
  expect(snapshot.imports).toEqual([
    { from: "src/caller.cts", to: "src/cjs.ts" },
    { from: "src/caller.cts", to: "src/esm.ts" },
  ]);
  expect(snapshot.sizes?.find(({ file }) => file === "src/caller.cts")).toEqual({
    file: "src/caller.cts", statements: 3, calls: ["src/cjs.ts", "src/cjs.ts"],
  });
});

test("inherited baseUrl and paths resolve from the extending config's parent", () => {
  const snapshot = sourceFixture({
    "tsconfig.json": JSON.stringify({ extends: "./settings/base.json", include: ["src/**/*.ts"] }),
    "settings/base.json": JSON.stringify({ compilerOptions: {
      ...options, baseUrl: "../src", paths: { "@chosen": ["target.ts"] },
    } }),
    "src/target.ts": "export function chosen(): number { return 7; }\n",
    "src/caller.ts": "import { chosen } from '@chosen';\nimport { chosen as other } from 'target';\nchosen();\nother();\n",
  });
  expect(snapshot.imports).toEqual([{ from: "src/caller.ts", to: "src/target.ts" }]);
  expect(snapshot.sizes?.find(({ file }) => file === "src/caller.ts")).toEqual({
    file: "src/caller.ts", statements: 4,
    calls: ["src/target.ts", "src/target.ts", "src/target.ts", "src/target.ts"],
  });
  expect(snapshot.compiler?.projects.flatMap(({ diagnostics }) => diagnostics)).toEqual([]);
});

test("alias and re-export calls charge their declaration owner rather than the barrel", () => {
  const snapshot = sourceFixture({
    "src/owner.ts": "export function original(): number { return 1; }\nexport class Vessel {}\n",
    "src/barrel.ts": "export { original as renamed, Vessel } from './owner.js';\n",
    "src/caller.ts": "import { renamed as run, Vessel } from './barrel.js';\nimport * as names from './barrel.js';\nrun();\nnames.renamed();\nnew Vessel();\nexport function forward(): number { return run(); }\n",
  });
  expect(snapshot.imports).toEqual([
    { from: "src/barrel.ts", to: "src/owner.ts" },
    { from: "src/caller.ts", to: "src/barrel.ts" },
  ]);
  expect(snapshot.sizes).toEqual([
    { file: "src/barrel.ts", statements: 1, calls: ["src/owner.ts"] },
    { file: "src/caller.ts", statements: 7, calls: ["src/barrel.ts", "src/barrel.ts",
      "src/owner.ts", "src/owner.ts", "src/owner.ts", "src/owner.ts"] },
    { file: "src/owner.ts", statements: 3, calls: [] },
  ]);
});

test("without a project, syntax sizes and relative edges remain while aliases have no owner", () => {
  const project = temporaryProjects.open("kit-parse-only-");
  try {
    project.write({
      "src/caller.ts": "import { original } from './owner.js';\nimport { other } from '@missing';\noriginal();\nexport function forward(): number { return original(); }\n",
      "src/owner.ts": "export function original(): number { return 1; }\n",
    });
    const snapshot = readSnapshot(project.root);
    expect(snapshot.compiler?.projects).toEqual([]);
    expect(snapshot.imports).toEqual([{ from: "src/caller.ts", to: "src/owner.ts" }]);
    expect(snapshot.sizes).toEqual([
      { file: "src/caller.ts", statements: 5, calls: [] },
      { file: "src/owner.ts", statements: 2, calls: [] },
    ]);
  } finally {
    project.dispose();
  }
});
