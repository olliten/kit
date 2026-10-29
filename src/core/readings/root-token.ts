// Stands for the app root inside stored text, so worktrees of one repository share what they store.
export const ROOT_TOKEN_JSON = JSON.stringify("\u0000kit-root\u0000").slice(1, -1);

// The root as JSON text: every mention, and the mentions that are a path ending at or continuing below it.
export function rootPattern(root: string): { readonly any: RegExp; readonly path: RegExp } {
  const escaped = JSON.stringify(root)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { any: new RegExp(escaped, "g"), path: new RegExp(`${escaped}(?=[/'\\s:),]|\\\\"|")`, "g") };
}

export const withoutRoot = (text: string, root: string): string =>
  text.replace(rootPattern(root).path, () => ROOT_TOKEN_JSON);

export const withRoot = (text: string, root: string): string =>
  text.replaceAll(ROOT_TOKEN_JSON, () => JSON.stringify(root).slice(1, -1));
