import { afterEach, expect, test } from "vitest";
import { sameSnapshot } from "../../src/core/readings/snapshot-comparison.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
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

test("a read that reuses stored facts equals a read without the store", () => {
  const app = open();
  expect(sameSnapshot(app.stored().snapshot, app.fresh())).toBe(true);
  app.put("src/core/primitives/value.ts", "export const value: number = 9;\n");
  const { snapshot, receipt } = app.stored();
  expect(receipt.files.reused).toBeGreaterThan(0);
  expect(snapshot).toEqual(app.fresh());
});

test("an entry the store can't read is computed again", () => {
  const app = open();
  app.stored();
  app.corrupt();
  const { snapshot, receipt } = app.stored();
  expect(receipt.files.reused).toBe(0);
  expect(receipt.proofs.reused).toBe(0);
  expect(snapshot).toEqual(app.fresh());
});

test("a file walked alone records what it records walked with the whole program", () => {
  // The compiler orders a union's parts by when it made them, so the reading's own union is created first only
  // when the reading is walked alone; its stored facts must still read as a fresh walk's.
  const app = open();
  app.put("src/core/readings/kinds.ts", 'export type Kind = "b" | "a";\nexport const kinds = (kind: Kind | number): Kind[] => [];\n');
  app.stored();
  app.put("src/core/readings/kinds.ts", 'export type Kind = "b" | "a";\nexport const kinds = (kind: number | Kind): Kind[] => [];\n');
  expect(app.stored().snapshot).toEqual(app.fresh());
});

test("kit check reads through the store, and --fresh reads without it and finds the same", async () => {
  const app = open();
  app.put("kit/config.md", "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nterms: spec/terms.md\nignore: evidence/\n```\n");
  app.put("kit/legacy.json", "{}\n");
  const engineRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const check = async (...flags: string[]) => {
    const result = await runCheck({
      engineRoot,
      args: ["--root", app.root, "--config", `${app.root}/kit/config.md`, "--baseline", `${app.root}/kit/legacy.json`, "--report", ...flags],
      cwd: app.root,
    });
    const report: { findings: unknown; receipt: { files: { reused: number; computed: number } } } = JSON.parse(result.stdout);
    return report;
  };
  const first = await check();
  const second = await check();
  const fresh = await check("--fresh");
  expect(second.receipt.files.computed).toBe(0);
  expect(fresh.receipt.files.reused).toBe(0);
  expect(fresh.findings).toEqual(first.findings);
  expect(second.findings).toEqual(first.findings);
});
