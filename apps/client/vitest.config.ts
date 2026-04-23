import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/lib/**/*.ts"],
      exclude: [
        // HTTP/WebSocket client code - integration-level, not unit-testable without a server
        "src/lib/api.ts",
        "src/lib/auth.ts",
        "src/lib/ws-upload.ts",
        // Complex browser crypto (ssh-keygen) - no test environment support
        "src/lib/ssh-keygen.ts",
      ],
    },
  },
});
