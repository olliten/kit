import type { Cell } from "../../core/primitives/schema.js";
import { writeCell } from "../primitives/cell-store.js";
import type { CellWriter } from "../primitives/cell-store.js";

export function writeAndRead(writer: CellWriter, cell: Cell): string {
  writeCell(writer, cell);
  return cell.value;
}
