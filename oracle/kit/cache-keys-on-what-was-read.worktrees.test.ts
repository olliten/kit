import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { cacheRunner, removeCacheApps, scratch, writeApp, CACHE_CONFIG } from "../substrate/compositions/cache-proof.js";
import { CACHE_APP } from "../core/primitives/cache-app.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { snapshotStore } from "../../src/substrate/adapters/snapshot-store.js";
import { CACHE_VERSION } from "../../src/core/readings/snapshot-cache-key.js";

afterEach(removeCacheApps);

function git(cwd: string, ...args: string[]): void {
  const result = processes.run("git", args, cwd);
  expect(result.status, result.stderr).toBe(0);
}

// Two linked worktrees: a main checkout differs from them by its `.git` directory, which a linked worktree
// has as a file the walk lists.
test("two worktrees of one repository reuse one cache entry", async () => {
  const base = scratch("kit-cache-worktrees-");
  const main = join(base, "main");
  const first = join(base, "first");
  const other = join(base, "other");
  writeApp(main, CACHE_APP);
  git(main, "init", "-q");
  git(main, "add", "-A");
  git(main, "-c", "user.name=kit", "-c", "user.email=kit@example.com", "commit", "-qm", "app");
  git(main, "worktree", "add", "-q", first);
  git(main, "worktree", "add", "-q", "--detach", other);
  expect(snapshotStore.directory(other)).toBe(join(main, ".git", "kit-cache"));
  expect(snapshotStore.directory(first)).toBe(snapshotStore.directory(other));

  const runner = cacheRunner();
  expect((await runner.run(first)).receipt.reused).toBe(false);
  const shared = await runner.run(other);
  expect(shared.receipt.reused).toBe(true);
  expect(runner.extractions()).toBe(1);
  expect(shared.result).toEqual(readSnapshot(other, CACHE_CONFIG));
  expect(snapshotStore.index(join(main, ".git", "kit-cache"), CACHE_VERSION).entries).toHaveLength(1);
}, 180_000);
