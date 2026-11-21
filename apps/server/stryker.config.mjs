import { strykerConfig } from "../../stryker.config.base.mjs";

export default strykerConfig({
  // The files vitest.config.ts measures coverage for.
  mutate: [
    "src/**/*.ts",
    "!src/index.ts",
    "!src/types.ts",
    "!src/storage/types.ts",
    "!src/storage/s3.ts",
    "!src/storage/index.ts",
  ],
});
