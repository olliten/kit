import { type Finding, byDebtKey, finding } from "./finding.js";
import { kindOf } from "./kind-of.js";
import type { Snapshot } from "./snapshot.js";

// What a run of words is: a term, or a retired word and the term that replaced it.
interface Entry {
  readonly term: string;
  readonly retired: boolean;
}

// R3, names: the terms file defines each term once; every module name and exported symbol of a placed
// file (a test's module prefix included) is built from terms and the config's connectors; no retired
// word appears in a name, in spec prose or in a placed file's comments. Only the `<name>` segment is a name: zone and kind segments
// are structure, and a test's law segment is its claim's anchor. A word matches a term or its plural:
// the term plus one of the config's plural suffixes, on the last word of a compound term
// (`running-totals` is `running-total`). Legacy files are not held.
export function nameCheck(snapshot: Snapshot): Finding[] {
  const { srcRoot, oracleRoot, termsFile, connectors, plurals } = snapshot.config;
  const findings: Finding[] = [];

  const termLines = new Map<string, number[]>();
  const entries = new Map<string, Entry>();
  for (const { term, line } of snapshot.terms) {
    termLines.set(term, [...(termLines.get(term) ?? []), line]);
    entries.set(wordsOf(term).join(" "), { term, retired: false });
  }
  for (const { term, retired } of snapshot.terms) {
    for (const word of retired) entries.set(wordsOf(word).join(" "), { term, retired: true });
  }
  for (const [term, lines] of termLines) {
    if (lines.length < 2) continue;
    const fix = `Keep one \`- **${term}** —\` line in ${termsFile}; it is defined on lines ${lines.join(", ")}.`;
    findings.push(finding("R3", "duplicate-term", term, fix));
  }

  // A run is an entry as written, or its plural: the last word less one plural suffix.
  const entryOf = (run: string): Entry | undefined =>
    entries.get(run) ??
    plurals
      .filter((suffix) => run.endsWith(suffix) && !run.endsWith(` ${suffix}`))
      .map((suffix) => entries.get(run.slice(0, -suffix.length)))
      .find((entry) => entry !== undefined);

  // Each run of words, longest match first, so a compound term wins over its parts.
  const longest = Math.max(1, ...[...entries.keys()].map((k) => k.split(" ").length));
  const scan = (path: string, text: string, isName: boolean): void => {
    const words = wordsOf(text);
    for (let i = 0; i < words.length; ) {
      let n = Math.min(longest, words.length - i);
      while (n > 1 && entryOf(words.slice(i, i + n).join(" ")) === undefined) n--;
      const run = words.slice(i, i + n).join(" ");
      const entry = entryOf(run);
      i += n;
      if (entry?.retired === true) {
        const fix = `In ${path}, \`${run}\` is retired: use the defined term \`${entry.term}\`.`;
        findings.push(finding("R3", "retired-word", path, fix, run.replaceAll(" ", "-")));
      } else if (isName && entry === undefined && !connectors.includes(run)) {
        const fix = `In ${path}, \`${run}\` is not a term: define it with a \`- **${run}** — <meaning>\` line in ${termsFile}, or use the defined term.`;
        findings.push(finding("R3", "undefined-word", path, fix, run));
      }
    }
  };

  for (const file of snapshot.files) {
    const at = kindOf(file.path, file.type === "test" ? oracleRoot : srcRoot);
    if (!at.placed) continue;
    if (file.type === "source") scan(at.artifact, at.name, true);
    if (file.type === "test") scan(file.path, at.name, true);
  }
  for (const { file, name } of snapshot.symbols) {
    const at = kindOf(file, srcRoot);
    if (at.placed) scan(at.artifact, name, true);
  }
  for (const { file, text } of snapshot.prose) scan(file, text, false);
  for (const { file, text } of snapshot.comments) {
    const test = file.startsWith(`${oracleRoot}/`);
    const at = kindOf(file, test ? oracleRoot : srcRoot);
    if (at.placed) scan(test ? file : at.artifact, text, false);
  }
  // One finding per debt key, however many names repeat a word.
  return [...new Map(findings.map((f) => [f.debtKey, f])).values()].sort(byDebtKey);
}

// A name's words, lower-cased: kebab, snake and dotted names split on their separators, camelCase and
// PascalCase on case boundaries (`runningTotal`, `running-total` and `RUNNING_TOTAL` are all `running total`).
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
}
