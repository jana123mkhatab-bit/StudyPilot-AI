import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws when imported outside Next's server bundling pipeline; under Vitest's
      // plain Node runtime every file that imports it is legitimately server-side, so stub it out.
      "server-only": path.resolve(__dirname, "vitest.setup.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
});
