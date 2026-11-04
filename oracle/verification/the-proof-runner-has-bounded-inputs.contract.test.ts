import { afterEach, expect, test } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleDoubles } from "../substrate/adapters/module-doubles.js";
import { proofRunner } from "../../src/substrate/adapters/proof-runner.js";
import { runProof } from "../../src/substrate/compositions/proof-run.js";

function boundary() {
  const calls: { parse: unknown[][]; start: unknown[][]; closed: number } = { parse: [], start: [], closed: 0 };
  const state: {
    options: Record<string, unknown>; acquired: boolean; status: string | number | undefined;
    startError: Error | undefined; closeError: Error | undefined;
  } = { options: {}, acquired: true, status: undefined, startError: undefined, closeError: undefined };
  moduleDoubles.configure({ exitCode: undefined });
  moduleDoubles.replace("vitest/node", {
    parseCLI(...args: unknown[]) {
      calls.parse.push(args);
      return { filter: ["oracle/example.test.ts"], options: { ...state.options } };
    },
    async startVitest(...args: unknown[]) {
      calls.start.push(args);
      if (state.startError) throw state.startError;
      moduleDoubles.configure({ exitCode: state.status });
      return state.acquired ? { async close() { calls.closed++; if (state.closeError) throw state.closeError; } } : undefined;
    },
  });
  return { calls, state };
}

afterEach(() => { moduleDoubles.restore(); });

test("the public command forwards execution options within an explicit bounded workspace and closes the acquired run", async () => {
  const { calls, state } = boundary();
  state.options = { root: "governed", exclude: ["ignored/**"], coverage: { enabled: true }, pool: "forks" };
  const args = ["run", "oracle/example.test.ts", "--coverage", "--pool=forks"];
  await expect(runProof({ args, cwd: "/caller" })).resolves.toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect(calls.parse).toEqual([[["vitest", ...args]]]);
  expect(calls.start).toEqual([["test", ["oracle/example.test.ts"], {
    root: resolve("/caller", "governed"), cliExclude: ["ignored/**"], coverage: { enabled: true }, pool: "forks",
    config: false, workspace: fileURLToPath(new URL("../../src/substrate/adapters/proof-runner.ts", import.meta.url)),
    run: true, watch: false,
  }, { configFile: false, envFile: false, css: { postcss: { plugins: [] } } }]]);
  expect(calls.closed).toBe(1);
});

test.each(["config", "workspace", "watch", "ui", "browser"])("%s cannot turn the bounded runner into application startup", async (option) => {
  const { calls, state } = boundary();
  state.options = { [option]: option === "config" || option === "workspace" ? "application.ts" : true };
  await expect(proofRunner.run(["run"], "/caller")).rejects.toThrow("bounded proof runner");
  expect(calls.start).toEqual([]);
});

test("the native boundary preserves failure status and normalizes one exclusion without discovering a root", async () => {
  const { calls, state } = boundary();
  state.options = { exclude: "ignored/**" };
  state.status = 7;
  await expect(proofRunner.run(["run"], "/caller")).resolves.toBe(7);
  expect(calls.start[0]?.[2]).toMatchObject({ root: "/caller", cliExclude: ["ignored/**"] });
  expect(calls.start[0]?.[2]).not.toHaveProperty("exclude");
  expect(calls.closed).toBe(1);
});

test("no acquired run is a failure and startup errors propagate rather than become a passing response", async () => {
  const { state } = boundary();
  state.acquired = false;
  await expect(runProof({ args: ["run"], cwd: "/caller" })).resolves.toEqual({ stdout: "", stderr: "", exitCode: 1 });
  state.startError = new Error("native startup failed");
  await expect(runProof({ args: ["run"], cwd: "/caller" })).rejects.toThrow("native startup failed");
});

test("cleanup errors cannot produce a successful proof response", async () => {
  const { state } = boundary();
  state.closeError = new Error("close failed");
  await expect(runProof({ args: ["run"], cwd: "/caller" })).rejects.toThrow("close failed");
});

test.each([[0, 1], ["0", 1], [7, 7]])("an absent run cannot turn SDK status %s into a false pass", async (status, expected) => {
  const { state } = boundary();
  state.acquired = false;
  state.status = status;
  await expect(runProof({ args: ["run"], cwd: "/caller" })).resolves.toEqual({ stdout: "", stderr: "", exitCode: expected });
});
