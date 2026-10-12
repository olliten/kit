import type { Cell } from "../../core/primitives/schema.js";
import type { CellWriter } from "../primitives/cell-store.js";

export type WriterShape = CellWriter;

export function cellShape(cell: Cell): readonly [string, string] {
  return [cell.key, cell.value];
}
