import { spawnSync } from "node:child_process";

// Another program run to completion: its output, errors and exit status.
export interface Processes {
  run(
    command: string,
    args: readonly string[],
    cwd?: string,
  ): { readonly stdout: string; readonly stderr: string; readonly status: number | null };
  node(): string;
}

export const processes: Processes = {
  run(command, args, cwd) {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      ...(cwd === undefined ? {} : { cwd }),
    });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  },
  node: () => process.execPath,
};
