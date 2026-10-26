// One source file of an LCOV report: the named functions it lists, by the line each starts on, and how often
// each ran. Runtimes number their anonymous functions, which belong to the named function holding them.
export interface CoveredFile {
  readonly file: string;
  readonly functions: readonly { readonly name: string; readonly line: number; readonly count: number }[];
}

const ANONYMOUS = /^\(?anonymous_\d+\)?$/;

// An LCOV report as its files. A count is matched to its function by name in order, so a file that names two
// functions alike pairs each count with its own line.
export function coverageReport(text: string): CoveredFile[] {
  const files: CoveredFile[] = [];
  let file: string | null = null;
  let listed: { name: string; line: number; count: number }[] = [];
  let counted = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      file = line.slice(3).trim();
      listed = [];
      counted = new Set();
    } else if (line.startsWith("FN:") && file !== null) {
      const match = /^FN:(\d+)(?:,\d+)?,(.+)$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined && !ANONYMOUS.test(match[2]))
        listed.push({ name: match[2], line: Number(match[1]), count: 0 });
    } else if (line.startsWith("FNDA:") && file !== null) {
      const match = /^FNDA:(\d+),(.+)$/.exec(line);
      const index = listed.findIndex((each, at) => each.name === match?.[2] && !counted.has(at));
      const entry = listed[index];
      if (entry !== undefined && match?.[1] !== undefined) {
        entry.count = Number(match[1]);
        counted.add(index);
      }
    } else if (line === "end_of_record" && file !== null) {
      files.push({ file, functions: listed });
      file = null;
    }
  }
  return files;
}
