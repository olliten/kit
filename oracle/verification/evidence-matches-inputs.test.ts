import { expect, test } from "vitest";
import { verificationPlan } from "../../src/core/readings/verification-plan.js";

const check = {
  id: "test:a",
  inputs: "tree:a",
  contract: "unit:v1",
  strength: 100,
  resource: "unit",
  needs: [],
};
const evidence = { ...check, inputs: "tree:a", passed: true };

test("only successful evidence for the same inputs and contract at sufficient strength is reused", () => {
  for (const inputs of ["tree:a", "tree:b"])
    for (const contract of ["unit:v1", "unit:v2"])
      for (const strength of [10, 100, 200])
        for (const passed of [false, true]) {
          const plan = verificationPlan(
            [check],
            [{ ...evidence, inputs, contract, strength, passed }],
          );
          const valid =
            inputs === check.inputs &&
            contract === check.contract &&
            strength >= check.strength &&
            passed;
          expect(plan.reused).toEqual(valid ? [check.id] : []);
          expect(plan.complete).toBe(valid);
          expect(plan.ready.map((c) => c.id)).toEqual(valid ? [] : [check.id]);
        }
});

test("unknown inputs and a different check identity never reuse evidence", () => {
  expect(verificationPlan([{ ...check, inputs: null }], [evidence]).reused).toEqual([]);
  expect(verificationPlan([check], [{ ...evidence, id: "test:b" }]).reused).toEqual([]);
  expect(verificationPlan([check], [evidence], { reuse: false }).reused).toEqual([]);
});

test("a new candidate can keep matching evidence and schedule only changed checks", () => {
  const checks = [check, { ...check, id: "test:b", inputs: "changed" }];
  const prior = [evidence, { ...evidence, id: "test:b" }];
  const plan = verificationPlan(checks, prior);
  expect(plan.reused).toEqual([check.id]);
  expect(plan.ready.map((c) => c.id)).toEqual(["test:b"]);
});
