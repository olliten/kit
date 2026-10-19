import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withKit } from "./kit-load.mjs";

let loaded;
export function verification() {
  return (loaded ??= withKit(
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    async (load) => ({
      ...(await load("src/core/readings/verification-plan.ts")),
      ...(await load("src/core/readings/verification-partition.ts")),
    }),
  ));
}

/** Effects remain supplied by the caller; a branch, store or test runner is never inspected here.
 * @param {readonly import('../src/core/primitives/verification.js').VerificationCheck[]} checks
 * @param {{run: (check: import('../src/core/primitives/verification.js').VerificationCheck) => Promise<{passed: boolean}> | {passed: boolean},
 * record?: (check: import('../src/core/primitives/verification.js').VerificationCheck, result: {passed: boolean}) => Promise<void> | void,
 * evidence?: readonly import('../src/core/primitives/verification.js').VerificationEvidence[],
 * capacity?: Readonly<Record<string, number>>, reuse?: boolean}} io
 */
export async function runVerification(
  checks,
  { run, record = () => {}, evidence = [], capacity = {}, reuse = true },
) {
  const { verificationPlan } = await verification();
  const completed = Object.create(null),
    results = new Map(),
    running = new Map();
  for (;;) {
    const plan = verificationPlan(checks, evidence, {
      completed,
      running: [...running.keys()],
      capacity,
      reuse,
    });
    for (const id of plan.reused) {
      completed[id] = true;
      results.set(id, { passed: true, reused: true });
    }
    for (const id of plan.blocked) {
      completed[id] = false;
      results.set(id, { passed: false, blocked: true });
    }
    if (plan.complete) return results;
    for (const check of plan.ready) {
      const task = Promise.resolve().then(async () => {
        let result;
        try {
          result = await run(check);
          if (typeof result?.passed !== "boolean")
            throw new Error(`Missing verdict for ${check.id}`);
          if (result.passed) await record(check, result);
        } catch (error) {
          result = { passed: false, error: String(error) };
        }
        completed[check.id] = result.passed;
        results.set(check.id, result);
        running.delete(check.id);
      });
      running.set(check.id, task);
    }
    if (!running.size) throw new Error("Verification made no progress");
    await Promise.race(running.values());
  }
}
