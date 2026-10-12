import type { CellWriter } from "../primitives/cell-store.js";

export function saveLater(
  writer: CellWriter,
  value: string,
): { readonly operation: { readonly run: () => void } } {
  return { operation: { run: () => writer.put({ key: "one", value }) } };
}
