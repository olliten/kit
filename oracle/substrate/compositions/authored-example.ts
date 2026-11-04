import { textFiles } from "../../../src/substrate/adapters/text-files.js";

// An example's authored inputs, with deliberate fixture replacements, never its runtime-output inventory.
export function authoredExample(root: string, overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  const files: Record<string, string> = { ...overrides };
  const read = (path: string): void => {
    if (!Object.hasOwn(overrides, path)) files[path] = textFiles.read(`${root}/${path}`);
  };
  const below = (path: string): void => {
    for (const entry of textFiles.entries(`${root}/${path}`)) {
      const child = `${path}/${entry.name}`;
      if (entry.directory) below(child);
      else if (entry.file) read(child);
    }
  };
  for (const path of ["package.json", "tsconfig.json"]) read(path);
  for (const path of ["src", "spec", "oracle", "kit"]) below(path);
  return files;
}
