import type { FunctionSpan } from "../primitives/function-span.js";
import { digest } from "./fact-keys.js";

// The outermost functions a run ran: each holding the start line of a function the coverage shows ran. A function
// that starts inside another ran inside it, so the outer one counts too; more counted is never less sound.
export function functionsRun(spans: readonly FunctionSpan[], ranLines: readonly number[]): number[] {
  return spans.flatMap((span, index) => (ranLines.some((line) => line >= span.lines[0] && line <= span.lines[1]) ? [index] : []));
}

// A loaded file as a run depends on it: its text with the body of every outermost function the run never ran
// left out. Which functions there are is part of that text, so the kept indices mean the same functions while
// it is the same.
export function ranText(text: string, spans: readonly FunctionSpan[], kept: readonly number[]): string {
  const keep = new Set(kept);
  let out = "";
  let at = 0;
  spans.forEach((span, index) => {
    if (keep.has(index)) return;
    out += `${text.slice(at, span.body[0])}{}`;
    at = span.body[1];
  });
  return out + text.slice(at);
}

// The state a loaded file is kept in, by the functions a run ran.
export const ranState = (text: string, spans: readonly FunctionSpan[], kept: readonly number[]): string =>
  `ran:${digest(ranText(text, spans, kept))}`;
