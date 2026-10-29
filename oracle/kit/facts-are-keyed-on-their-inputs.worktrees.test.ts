import { afterEach, expect, test } from "vitest";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";
import { type SmallApp, smallApp } from "../substrate/compositions/extraction-proof.js";

const apps: SmallApp[] = [];
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
  for (const project of projects.splice(0)) project.dispose();
});

test("a repository and its worktrees keep one store in their common Git directory", () => {
  const project = temporaryProjects.open("kit-worktrees-");
  projects.push(project);
  project.write({
    "main/.git/HEAD": "ref: refs/heads/main\n",
    "main/.git/worktrees/side/commondir": "../..\n",
    "side/.git": `gitdir: ${project.root}/main/.git/worktrees/side\n`,
    "main/src/a.ts": "export {};\n",
  });
  const store = evidenceStore.directory(`${project.root}/main`);
  expect(store).toBe(`${project.root}/main/.git/kit-store`);
  expect(evidenceStore.directory(`${project.root}/side`)).toBe(store);
  expect(evidenceStore.directory(`${project.root}/main/src`)).toBe(store);
});

test("two checkouts of one app at different roots share one store", () => {
  const first = smallApp();
  apps.push(first);
  const second = smallApp(undefined, first.store);
  apps.push(second);
  expect(first.root).not.toBe(second.root);
  first.stored();
  const { snapshot, receipt } = second.stored();
  expect(receipt.files.computed).toBe(0);
  expect(receipt.proofs.computed).toBe(0);
  expect(snapshot).toEqual(second.fresh());
});
