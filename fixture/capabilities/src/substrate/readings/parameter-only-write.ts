import type { Cell } from "../../core/primitives/schema.js";
import type { CellWriter } from "../primitives/cell-store.js";

export function readViaPort(writer: CellWriter, cell: Cell): string {
  writer.put(cell);
  return cell.value;
}
