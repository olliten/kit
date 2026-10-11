import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The kit's own runner. It is not part of the app's gate.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: { include: ["oracle/**/*.test.ts"] },
});
