import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import {
  CACHE_APP,
  CACHE_CONFIG,
  adapters,
  cacheDirectory,
  cachedKitCheck,
  removeCacheApps,
  scratch,
  writeApp,
} from "../lib/cache-fixture.js";

afterEach(removeCacheApps);

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
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
  expect(cacheDirectory(other)).toBe(join(main, ".git", "kit-cache"));
  expect(cacheDirectory(first)).toBe(cacheDirectory(other));

  let extractions = 0;
  const read = (...args: Parameters<typeof readSnapshot>) => {
    extractions++;
    return readSnapshot(...args);
  };
  const run = (root: string) =>
    cachedKitCheck(root, CACHE_CONFIG, read, (snapshot: unknown) => snapshot, adapters);
  expect((await run(first)).receipt.reused).toBe(false);
  const shared = await run(other);
  expect(shared.receipt.reused).toBe(true);
  expect(extractions).toBe(1);
  expect(shared.result).toEqual(readSnapshot(other, CACHE_CONFIG));
  const index = JSON.parse(readFileSync(join(main, ".git", "kit-cache", "index.json"), "utf8"));
  expect(index.entries).toHaveLength(1);
}, 180_000);
