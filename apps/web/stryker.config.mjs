import { strykerConfig } from "../../stryker.config.base.mjs";

export default strykerConfig({
  // The files vite.config.ts measures coverage for. Components are not unit-tested.
  mutate: [
    "src/lib/**/*.ts",
    "src/hooks/**/*.{ts,tsx}",
    "!src/lib/sw-download.ts",
    "!src/lib/opfs-file.ts",
    "!src/lib/opfs-file-worker.ts",
    "!src/lib/upload-worker.ts",
    "!src/lib/api.ts",
    "!src/lib/argon2.ts",
    "!src/lib/ssh-keygen.ts",
  ],
});
