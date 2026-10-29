import { afterEach, expect, test } from "vitest";
import { type SmallApp, smallApp } from "../substrate/compositions/extraction-proof.js";

const apps: SmallApp[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
});
const open = (): SmallApp => {
  const app = smallApp();
  apps.push(app);
  return app;
};
const computed = (app: SmallApp) => {
  const { files, proofs } = app.stored().receipt;
  return { files: files.computed, proofs: proofs.computed };
};

test("a first read computes every file and test, and a second reuses them all", () => {
  const app = open();
  const first = app.stored().receipt;
  expect(first.files.reused).toBe(0);
  expect(first.files.computed).toBeGreaterThan(0);
  expect(first.proofs).toEqual({ reused: 0, computed: 1 });
  expect(computed(app)).toEqual({ files: 0, proofs: 0 });
});

test("an edit recomputes exactly the files whose imports reach it, and the tests among them", () => {
  const app = open();
  app.stored();
  app.put("src/core/readings/half.ts", "export const half = (n: number): number => n * 0.5;\n");
  expect(computed(app)).toEqual({ files: 1, proofs: 0 });
  app.put("src/core/primitives/value.ts", "export const value = 8;\n");
  expect(computed(app)).toEqual({ files: 3, proofs: 1 });
});

test("an edit to what the whole project depends on recomputes every file", () => {
  const app = open();
  const all = app.stored().receipt.files.computed;
  app.put("node_modules/a/index.d.ts", "export interface Shape { readonly n: number; readonly m?: number; }\n");
  expect(computed(app).files).toBe(all);
  app.put("src/core/primitives/limit.ts", "declare global {\n  var limit: string;\n}\nexport {};\n");
  expect(computed(app).files).toBe(all);
  app.put(
    "config/base.json",
    '{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","lib":["ES2022"],"strict":false,"noEmit":true,"skipLibCheck":true}}',
  );
  expect(computed(app).files).toBe(all);
  expect(app.stored("another kit").receipt.files.computed).toBe(all);
});

test("an edit nothing read, ignored or never opened, recomputes nothing", () => {
  const app = open();
  app.stored();
  app.put("evidence/read-cost/2.json", "{}\n");
  app.put("node_modules/a/README.md", "# a, again\n");
  expect(computed(app)).toEqual({ files: 0, proofs: 0 });
});
