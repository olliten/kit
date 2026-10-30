import type { CodeToken } from "../primitives/code-token.js";
import type { FunctionSpan } from "../primitives/function-span.js";
import { digest } from "./fact-keys.js";

// The outermost functions a run ran: each holding the start line of a function the coverage shows ran. A function
// that starts inside another ran inside it, so the outer one counts too; more counted is never less sound.
export function functionsRun(spans: readonly FunctionSpan[], ranLines: readonly number[]): number[] {
  return spans.flatMap((span, index) => (ranLines.some((line) => line >= span.lines[0] && line <= span.lines[1]) ? [index] : []));
}

// A comment a tool reads: a compiler, bundler or coverage directive, a source map, a license or a reference.
const toolComment = /^\/[/*]\s*(?:[@#!/]|(?:node:coverage|c8|istanbul|v8)\b)/;

// Whether a comment can change what a run or a check of the file finds. In a JavaScript file, a `/**` comment
// can hold the types a check of JavaScript reads.
const commentCounts = (path: string, text: string): boolean =>
  toolComment.test(text) || (/\.[cm]?jsx?$/.test(path) && text.startsWith("/**"));

// A loaded file's code as a run depends on it: its tokens and the comments that count, with the body of every
// outermost function the run never ran left out. Which functions there are is part of that code, so the kept
// indices mean the same functions while it is the same.
export function ranCode(path: string, tokens: readonly CodeToken[], spans: readonly FunctionSpan[], kept: readonly number[]): CodeToken[] {
  const keep = new Set(kept);
  const cut = spans.filter((_, index) => !keep.has(index));
  const out: CodeToken[] = [];
  let next = 0;
  for (const token of tokens) {
    while (next < cut.length && (cut[next]?.body[1] ?? 0) <= token.at[0]) next += 1;
    const body = cut[next]?.body;
    if (body !== undefined && token.at[0] >= body[0]) {
      // The body's first token stands for the whole body.
      if (token.at[0] === body[0]) out.push({ at: [body[0], body[1]], text: "{}", comment: false, line: token.line });
      continue;
    }
    if (!token.comment || commentCounts(path, token.text)) out.push(token);
  }
  return out;
}

// The state a loaded file is kept in, by the functions a run ran. Where a piece stands is left out, so moving
// code by whitespace or a comment keeps it.
export const ranState = (path: string, tokens: readonly CodeToken[], spans: readonly FunctionSpan[], kept: readonly number[]): string =>
  `ran:${digest(JSON.stringify(ranCode(path, tokens, spans, kept).map((token) => [token.line, token.text])))}`;
