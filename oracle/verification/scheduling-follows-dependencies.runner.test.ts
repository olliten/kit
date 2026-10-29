import { expect, test } from "vitest";
import type { VerificationCheck } from "../../src/core/primitives/verification.js";
import { scriptedVerification } from "../substrate/compositions/scripted-verification.js";

const check = (
  id: string,
  resource = "unit",
  needs: readonly string[] = [],
): VerificationCheck => ({
  id,
  inputs: `tree:${id}`,
  contract: "test:v1",
  strength: 100,
  resource,
  needs,
});

test("independent work overlaps, capacity holds, and dependencies wait for recorded success", async () => {
  const jobs = [
    check("build", "build"),
    check("a"),
    check("b"),
    check("browser", "browser", ["build"]),
  ];
  const run = await scriptedVerification(jobs, {
    capacity: { unit: 1, build: 1, browser: 1 },
    steps: [
      { when: ["build", "a"], release: "build" },
      { when: ["browser"], release: "a" },
      { when: ["b"], release: "b" },
      { when: [], release: "browser" },
    ],
  });
  for (const start of run.starts) {
    const job = jobs.find((each) => each.id === start.id);
    expect(job?.needs.every((id) => start.recorded.includes(id))).toBe(true);
    if (job?.resource === "unit") expect(start.running.includes("a") || start.running.includes("b")).toBe(false);
  }
  expect(run.snapshots.slice(0, 2)).toEqual([
    { release: "build", running: ["a", "build"], started: ["a", "build"] },
    { release: "a", running: ["a", "browser"], started: ["a", "browser", "build"] },
  ]);
  expect(run.snapshots.map((snapshot) => snapshot.release)).toEqual(["build", "a", "b", "browser"]);
  expect([...run.results.values()].every((result) => result.passed)).toBe(true);
  expect(run.recorded.length).toBe(jobs.length);
});

const failures: readonly ("verdict" | "execution" | "record")[] = ["verdict", "execution", "record"];

test.each(failures)(
  "a %s failure blocks descendants while unrelated work settles",
  async (failure) => {
    const jobs = [
      check("bad"),
      check("child", "browser", ["bad"]),
      check("grandchild", "browser", ["child"]),
      check("good", "static"),
    ];
    const run = await scriptedVerification(jobs, {
      scripts: {
        bad:
          failure === "verdict" ? { verdict: "fail" } : failure === "execution" ? { verdict: "throw" } : { record: "throw" },
      },
    });
    expect(run.starts.map((start) => start.id).sort()).toEqual(["bad", "good"]);
    expect(run.results.get("bad")?.passed).toBe(false);
    expect(run.results.get("good")?.passed).toBe(true);
    expect(run.results.get("child")).toEqual({ passed: false, blocked: true });
    expect(run.results.get("grandchild")).toEqual({ passed: false, blocked: true });
  },
);

test("an invalid graph starts no execution", async () => {
  const run = await scriptedVerification([check("a", "unit", ["missing"])]);
  expect(run.error).toBeDefined();
  expect(run.starts).toEqual([]);
});

test("matching evidence skips execution and recording unless the policy requests a fresh run", async () => {
  const job = check("a");
  const evidence = [{ ...job, inputs: "tree:a", passed: true }];
  for (const reuse of [true, false]) {
    const run = await scriptedVerification([job], { evidence, reuse });
    expect(run.results.get("a")?.passed).toBe(true);
    expect(run.starts.length).toBe(reuse ? 0 : 1);
    expect(run.recorded.length).toBe(reuse ? 0 : 1);
  }
});
