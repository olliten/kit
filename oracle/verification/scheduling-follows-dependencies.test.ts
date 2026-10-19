import { expect, test } from "vitest";
import { verificationPlan } from "../../src/core/readings/verification-plan.js";

const check = (id: string, resource = "unit", needs: readonly string[] = []) => ({
  id,
  inputs: `tree:${id}`,
  contract: "test:v1",
  strength: 100,
  resource,
  needs,
});
const checks = [
  check("build", "build"),
  check("unit", "unit", ["build"]),
  check("browser", "browser", ["build"]),
  check("scan", "static"),
];

test("only satisfied dependencies unlock work, and independent resources run together", () => {
  expect(
    verificationPlan(checks, [])
      .ready.map((c) => c.id)
      .sort(),
  ).toEqual(["build", "scan"]);
  expect(
    verificationPlan(checks, [], { completed: { build: true } })
      .ready.map((c) => c.id)
      .sort(),
  ).toEqual(["browser", "scan", "unit"]);
  const failed = verificationPlan(checks, [], { completed: { build: false, scan: true } });
  expect([...failed.blocked].sort()).toEqual(["browser", "unit"]);
  expect(failed.complete).toBe(true);
  expect(failed.passed).toBe(false);
});

test("running work consumes its own resource capacity without blocking another resource", () => {
  const jobs = [check("a"), check("b"), check("c", "browser")];
  const plan = verificationPlan(jobs, [], { running: ["a"], capacity: { unit: 1, browser: 1 } });
  expect(plan.ready.map((c) => c.id)).toEqual(["c"]);
  expect(plan.pending).toContain("b");
  expect(plan.complete).toBe(false);
});

test("valid reused dependencies unlock their dependants", () => {
  const build = checks[0];
  if (build === undefined) throw new Error("missing fixture build");
  const plan = verificationPlan(checks, [{ ...build, inputs: "tree:build", passed: true }]);
  expect(plan.reused).toEqual(["build"]);
  expect(plan.ready.map((c) => c.id).sort()).toEqual(["browser", "scan", "unit"]);
});

test("malformed graphs fail before any work is offered", () => {
  for (const jobs of [
    [check("a"), check("a")],
    [check("a", "unit", ["missing"])],
    [check("a", "unit", ["b"]), check("b", "unit", ["a"])],
  ])
    expect(() => verificationPlan(jobs, [])).toThrow();
});
