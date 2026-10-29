// What a launcher hands a Kit command, and what the command answers. The launcher owns the terminal, so a
// command is proved by calling it; a command that reads its input also takes the terminal input adapter.
export interface CommandRequest {
  readonly engineRoot: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface CommandResponse {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}
