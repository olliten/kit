import type { WriteDescription } from "../../core/primitives/write-description.js";

export interface DescriptionWriter {
  readonly put: (description: WriteDescription) => void;
}

export function applyDescription(writer: DescriptionWriter, description: WriteDescription): void {
  writer.put(description);
}
