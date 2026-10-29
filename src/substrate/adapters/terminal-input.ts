import { readFileSync } from "node:fs";

// What a command was given on its standard input, read whole only when the command asks for it.
export interface TerminalInput {
  read(): string;
}

export const terminalInput: TerminalInput = { read: () => readFileSync(0, "utf8") };
