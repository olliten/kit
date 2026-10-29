import { spawn, spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";

// Another program run to completion, optionally given text on its input: its output, errors and exit status.
export interface Processes {
  run(
    command: string,
    args: readonly string[],
    cwd?: string,
    input?: string,
  ): { readonly stdout: string; readonly stderr: string; readonly status: number | null };
  // Shell command lines, as many at once as the machine runs in parallel, in one directory, each with its own
  // added environment variables.
  shells(
    lines: readonly { readonly line: string; readonly env: Readonly<Record<string, string>> }[],
    cwd: string,
  ): Promise<readonly { readonly stdout: string; readonly stderr: string; readonly status: number | null }[]>;
  node(): string;
}

function shell(
  line: string,
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(line, { cwd, shell: true, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (status) => resolve({ stdout, stderr, status }));
    child.on("error", (error) => resolve({ stdout, stderr: stderr + error.message, status: null }));
  });
}

export const processes: Processes = {
  run(command, args, cwd, input) {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      ...(cwd === undefined ? {} : { cwd }),
      ...(input === undefined ? {} : { input }),
    });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  },
  async shells(lines, cwd) {
    const results: { stdout: string; stderr: string; status: number | null }[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let at = next++; at < lines.length; at = next++) {
        const job = lines[at];
        if (job !== undefined) results[at] = await shell(job.line, cwd, job.env);
      }
    };
    await Promise.all(Array.from({ length: Math.min(availableParallelism(), lines.length) }, worker));
    return results;
  },
  node: () => process.execPath,
};
