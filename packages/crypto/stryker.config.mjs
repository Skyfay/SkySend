import { strykerConfig } from "../../stryker.config.base.mjs";

export default strykerConfig({
  mutate: ["src/**/*.ts", "!src/index.ts"],
  // The pull request check runs this package and fails below the break score. Around 91 % when
  // it was set up. Most of the rest cannot be tested, like wiping a key from memory or the limit
  // of 2^32 records of a stream.
  thresholds: { high: 90, low: 85, break: 85 },
});
