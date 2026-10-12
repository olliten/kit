import type { Cell } from "../../core/primitives/schema.js";

export interface CellWriter {
  readonly put: (cell: Cell) => void;
}

export function writeCell(writer: CellWriter, cell: Cell): void {
  writer.put(cell);
}

export function cleanText(value: string): string {
  return value.trim();
}
