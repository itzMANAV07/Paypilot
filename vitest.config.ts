import { defineConfig } from "vitest/config";
import path from "path";
import os from "os";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      AUDIT_LOG_PATH: path.join(os.tmpdir(), "paypilot-test-audit.json"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

