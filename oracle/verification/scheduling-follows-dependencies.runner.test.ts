import { expect, test } from "vitest";
import { runVerification } from "../../src/substrate/compositions/verification-runner.mjs";
import type { VerificationCheck } from "../../src/core/primitives/verification.js";

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
  const active = new Set<string>();
  const finished = new Set<string>();
  const releases = new Map<string, () => void>();
  let notify = () => {};
  const started = () =>
    new Promise<void>((resolve) => {
      notify = resolve;
    });
  const waitFor = async (id: string) => {
    while (!releases.has(id)) await started();
  };
  const execution = runVerification(jobs, {
    capacity: { unit: 1, build: 1, browser: 1 },
    run: async (job: VerificationCheck) => {
      expect(job.needs.every((id) => finished.has(id))).toBe(true);
      if (job.resource === "unit") expect(active.has("a") || active.has("b")).toBe(false);
      active.add(job.id);
      await new Promise<void>((resolve) => {
        releases.set(job.id, resolve);
        notify();
      });
      active.delete(job.id);
      return { passed: true };
    },
    record: async (job: VerificationCheck) => {
      finished.add(job.id);
    },
  });
  await waitFor("build");
  await waitFor("a");
  expect(active).toEqual(new Set(["build", "a"]));
  expect(releases.has("b")).toBe(false);
  expect(releases.has("browser")).toBe(false);
  releases.get("build")?.();
  await waitFor("browser");
  expect(active).toEqual(new Set(["a", "browser"]));
  releases.get("a")?.();
  await waitFor("b");
  releases.get("b")?.();
  releases.get("browser")?.();
  const results = await execution;
  expect([...results.values()].every((result) => result.passed)).toBe(true);
  expect(finished.size).toBe(jobs.length);
});

test.each(["verdict", "execution", "record"])(
  "a %s failure blocks descendants while unrelated work settles",
  async (failure) => {
    const jobs = [
      check("bad"),
      check("child", "browser", ["bad"]),
      check("grandchild", "browser", ["child"]),
      check("good", "static"),
    ];
    const ran: string[] = [];
    const results = await runVerification(jobs, {
      run: async (job: VerificationCheck) => {
        ran.push(job.id);
        if (job.id === "bad" && failure === "execution") throw new Error("execution failed");
        return { passed: job.id !== "bad" || failure !== "verdict" };
      },
      record: async (job: VerificationCheck) => {
        if (job.id === "bad" && failure === "record") throw new Error("record failed");
      },
    });
    expect(ran.sort()).toEqual(["bad", "good"]);
    expect(results.get("bad")?.passed).toBe(false);
    expect(results.get("good")?.passed).toBe(true);
    expect(results.get("child")).toEqual({ passed: false, blocked: true });
    expect(results.get("grandchild")).toEqual({ passed: false, blocked: true });
  },
);

test("an invalid graph starts no execution", async () => {
  let calls = 0;
  await expect(
    runVerification([check("a", "unit", ["missing"])], {
      run: async () => {
        calls++;
        return { passed: true };
      },
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("matching evidence skips execution and recording unless the policy requests a fresh run", async () => {
  const job = check("a");
  const evidence = [{ ...job, inputs: "tree:a", passed: true }];
  for (const reuse of [true, false]) {
    let executions = 0;
    let recordings = 0;
    const results = await runVerification([job], {
      evidence,
      reuse,
      run: async () => {
        executions++;
        return { passed: true };
      },
      record: async () => {
        recordings++;
      },
    });
    expect(results.get("a")?.passed).toBe(true);
    expect(executions).toBe(reuse ? 0 : 1);
    expect(recordings).toBe(reuse ? 0 : 1);
  }
});
