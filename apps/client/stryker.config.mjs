import { strykerConfig } from "../../stryker.config.base.mjs";

export default strykerConfig({
  // The files vitest.config.ts measures coverage for.
  mutate: [
    "src/lib/**/*.ts",
    "!src/lib/api.ts",
    "!src/lib/auth.ts",
    "!src/lib/upload-job.ts",
    "!src/lib/download-job.ts",
    "!src/lib/inbox-job.ts",
    "!src/lib/ssh-keygen.ts",
  ],
});
