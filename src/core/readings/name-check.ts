import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf, proofOf } from "./placement-of.js";

// What a run of words is: a term, or a retired word and the term that replaced it.
interface Entry {
  readonly term: string;
  readonly retired: boolean;
}

// Identifier tokenization recognizes camel-case and kebab-case retirement spellings;
// definition identity keeps punctuation because it names a global concept.
export function nameCheck(snapshot: Snapshot): Finding[] {
  const { srcRoot, oracleRoot, termsFile, plurals } = snapshot.config;
  const findings: Finding[] = [];

  const termLines = new Map<string, number[]>();
  const entries = new Map<string, Entry>();
  for (const { term, line } of snapshot.terms) {
    const identity = term.toLowerCase().trim().replace(/\s+/g, " ");
    termLines.set(identity, [...(termLines.get(identity) ?? []), line]);
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
  const scan = (path: string, text: string): void => {
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
      }
    }
  };

  for (const file of snapshot.files) {
    const at = placementOf(file.path, srcRoot);
    if (file.type === "source" && at.placed) scan(at.artifact, at.name);
    if (file.type === "test" && proofOf(file.path, oracleRoot) !== null) scan(file.path, file.path);
  }
  for (const { file, name } of snapshot.symbols) {
    const at = placementOf(file, srcRoot);
    if (at.placed) scan(at.artifact, name);
  }
  for (const { file, text } of snapshot.prose) scan(file, text);
  for (const { file, text } of snapshot.comments) {
    const test = file.startsWith(`${oracleRoot}/`);
    const at = placementOf(file, srcRoot);
    if (at.placed) scan(at.artifact, text);
    else if (test && proofOf(file, oracleRoot) !== null) scan(file, text);
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
import type { Snapshot } from "../primitives/snapshot.js";
