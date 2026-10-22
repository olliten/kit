import { afterEach, expect, test } from "vitest";
import { changeLog } from "../../src/substrate/adapters/change-log.js";
import {
  type TemporaryRepository,
  temporaryRepositories,
} from "../substrate/adapters/temporary-repository.js";

let repository: TemporaryRepository | undefined;
afterEach(() => repository?.dispose());

const opened = (): TemporaryRepository => {
  repository = temporaryRepositories.open("kit-change-log-");
  repository.commit({ "spec/tally.md": "# Tally\n", "oracle/tally/total-sums.test.ts": "one\n", "old.txt": "x\n" }, "Start");
  repository.branch("change");
  return repository;
};

test("the change log lists what a branch added, modified and deleted since it left its base", () => {
  const repo = opened();
  repo.commit({ "oracle/tally/total-sums.test.ts": "two\n", "old.txt": null }, "Edit");
  repo.commit({ "oracle/tally/total-sums.more.test.ts": "three\n" }, "Add\n\nTest fix: oracle/tally/total-sums.test.ts: why");
  const history = changeLog.since(repo.root, "main");
  expect([...history.files].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    { status: "deleted", path: "old.txt" },
    { status: "added", path: "oracle/tally/total-sums.more.test.ts" },
    { status: "modified", path: "oracle/tally/total-sums.test.ts" },
  ]);
  expect(history.messages).toEqual(["Add\n\nTest fix: oracle/tally/total-sums.test.ts: why", "Edit"]);
});

test("the base is where the branch left it, so later commits on the base are not the change's", () => {
  const repo = opened();
  repo.commit({ "oracle/tally/total-sums.test.ts": "two\n" }, "Edit");
  repo.switch("main");
  repo.commit({ "spec/tally.md": "# Tally, later\n" }, "Later on the base");
  repo.switch("change");
  expect(changeLog.since(repo.root, "main").files.map((file) => file.path)).toEqual([
    "oracle/tally/total-sums.test.ts",
  ]);
});
