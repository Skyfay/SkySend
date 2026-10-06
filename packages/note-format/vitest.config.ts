import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        // Pure re-export barrel - no executable logic to test
        "src/index.ts",
      ],
    },
  },
});
