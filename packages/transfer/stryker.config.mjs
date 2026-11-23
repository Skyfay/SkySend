import { strykerConfig } from "../../stryker.config.base.mjs";

export default strykerConfig({
  mutate: [
    "src/**/*.ts",
    "!src/index.ts",
    // Everything in zip.ts except the CRC-32 table and crc32(). A test sums 16 MiB with it,
    // which instrumented takes longer than the whole test run may.
    "!src/zip.ts",
    "src/zip.ts:1-99",
    "src/zip.ts:140-307",
  ],
});
