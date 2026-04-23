import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        // App entrypoint - wires up the server, not unit-testable
        "src/index.ts",
        // Pure type definitions
        "src/types.ts",
        "src/storage/types.ts",
        // S3 storage - requires live AWS/S3 credentials to test meaningfully
        "src/storage/s3.ts",
        "src/storage/index.ts",
      ],
    },
  },
});
