import { sourceLoader } from "../adapters/source-loader.mjs";

/** @type {Promise<Record<string, unknown>> | undefined} */
let loaded;
// The pure planner and partitioner, loaded once for callers that run under plain Node.
export function verification() {
  return (loaded ??= sourceLoader.load(decodeURIComponent(new URL("../../..", import.meta.url).pathname).replace(/\/$/, ""), [
    "src/core/readings/verification-plan.ts",
    "src/core/readings/verification-partition.ts",
  ]));
}

// Effects remain supplied by the caller; a branch, store or test runner is never inspected here.
/**
 * @template {{ readonly id: string }} Check
 * @param {readonly Check[]} checks
 * @param {{ run: (check: Check) => Promise<{ passed: boolean }> | { passed: boolean },
 *   record?: (check: Check, result: { passed: boolean }) => Promise<void> | void,
 *   evidence?: readonly unknown[], capacity?: Readonly<Record<string, number>>, reuse?: boolean }} io
 * @returns {Promise<Map<string, { passed: boolean, reused?: boolean, blocked?: boolean, error?: string }>>}
 */
export async function runVerification(checks, { run, record = () => {}, evidence = [], capacity = {}, reuse = true }) {
  const verificationPlan = Reflect.get(await verification(), "verificationPlan");
  if (typeof verificationPlan !== "function") throw new Error("The verification planner did not load.");
  /** @type {Record<string, boolean>} */
  const completed = Object.create(null);
  /** @type {Map<string, { passed: boolean, reused?: boolean, blocked?: boolean, error?: string }>} */
  const results = new Map();
  /** @type {Map<string, Promise<void>>} */
  const running = new Map();
  for (;;) {
    const plan = verificationPlan(checks, evidence, { completed, running: [...running.keys()], capacity, reuse });
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
        /** @type {{ passed: boolean, error?: string }} */
        let result;
        try {
          result = await run(check);
          if (typeof result?.passed !== "boolean") throw new Error(`Missing verdict for ${check.id}`);
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
