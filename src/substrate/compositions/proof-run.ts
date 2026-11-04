import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import { proofRunner } from "../adapters/proof-runner.js";

// Vitest owns its terminal output; the normal launcher owns the process arguments and final status.
export async function runProof({ args, cwd }: Pick<CommandRequest, "args" | "cwd">): Promise<CommandResponse> {
  return { stdout: "", stderr: "", exitCode: await proofRunner.run(args, cwd) };
}
