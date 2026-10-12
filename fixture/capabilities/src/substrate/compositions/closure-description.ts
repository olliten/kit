import type { CellWriter } from "../primitives/cell-store.js";

export interface Description {
  readonly apply: () => void;
}

export function description(writer: CellWriter): Description {
  return { apply: () => writer.put({ key: "one", value: "saved" }) };
}
