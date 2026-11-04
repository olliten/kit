import { expect, test } from "vitest";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("compiler facts follow extraction producers and their installed compiler rather than unrelated checker policy", () => {
  const project = temporaryProjects.open("kit-extraction-identity-");
  const producer = 'import { facts } from "./project-facts.js";\nexport const snapshot = () => facts();\n';
  const loader = 'export const load = () => import("vite");\n';
  const lock = (version: string) => JSON.stringify({ lockfileVersion: 3, packages: {
    "": { name: "kit" }, "node_modules/typescript": { version, integrity: `sha512-${version}` },
    "node_modules/vite": { version: "5.0.0", integrity: "sha512-vite" },
  } });
  try {
    project.write({
      "package.json": JSON.stringify({ name: "kit", type: "module" }),
      "package-lock.json": lock("5.4.0"),
      "src/substrate/compositions/read-snapshot.ts": producer,
      "src/substrate/compositions/project-facts.ts": 'import ts from "typescript";\nexport const facts = () => ts.version;\n',
      "src/substrate/adapters/source-loader.mjs": loader,
      "src/core/readings/function-governance.ts": "export const policy = 1;\n",
    });
    const original = toolchain.extraction(project.root);
    project.write({ "src/core/readings/function-governance.ts": "export const policy = 2;\n" });
    expect(toolchain.extraction(project.root)).toBe(original);
    project.write({ "src/substrate/compositions/project-facts.ts": 'import ts from "typescript";\nexport const facts = () => ts.version + "changed";\n' });
    expect(toolchain.extraction(project.root)).not.toBe(original);
    project.write({ "src/substrate/compositions/project-facts.ts": 'import ts from "typescript";\nexport const facts = () => ts.version;\n', "package-lock.json": lock("5.5.0") });
    expect(toolchain.extraction(project.root)).not.toBe(original);
    project.write({ "package-lock.json": lock("5.4.0"), "src/substrate/adapters/source-loader.mjs": loader + "export const compilerMode = 2;\n" });
    expect(toolchain.extraction(project.root)).not.toBe(original);
  } finally {
    project.dispose();
  }
});

test("an unknown dynamic producer dependency conservatively holds the full engine", () => {
  const project = temporaryProjects.open("kit-extraction-dynamic-");
  try {
    project.write({
      "package.json": JSON.stringify({ name: "kit", type: "module" }),
      "src/substrate/compositions/read-snapshot.ts": "export const snapshot = (path: string) => import(path);\n",
      "src/substrate/adapters/source-loader.mjs": "export const load = () => 1;\n",
      "src/core/readings/policy.ts": "export const policy = 1;\n",
    });
    const original = toolchain.extraction(project.root);
    project.write({ "src/core/readings/policy.ts": "export const policy = 2;\n" });
    expect(toolchain.extraction(project.root)).not.toBe(original);
  } finally {
    project.dispose();
  }
});

test.each(["alias", "absolute"])("an unresolved %s producer dependency conservatively holds the full engine", (mode) => {
  const project = temporaryProjects.open("kit-extraction-unresolved-");
  try {
    const specifier = mode === "alias" ? "#producer" : `${project.root}/src/substrate/compositions/facts.ts`;
    project.write({
      "package.json": JSON.stringify({ name: "kit", type: "module", imports: { "#producer": "./src/substrate/compositions/facts.ts" } }),
      "src/substrate/compositions/read-snapshot.ts": `import { facts } from ${JSON.stringify(specifier)};\nexport const snapshot = () => facts();\n`,
      "src/substrate/compositions/facts.ts": "export const facts = () => 1;\n",
      "src/substrate/adapters/source-loader.mjs": "export const load = () => 1;\n",
      "src/core/readings/policy.ts": "export const policy = 1;\n",
    });
    const original = toolchain.extraction(project.root);
    project.write({ "src/core/readings/policy.ts": "export const policy = 2;\n" });
    expect(toolchain.extraction(project.root)).not.toBe(original);
  } finally {
    project.dispose();
  }
});
