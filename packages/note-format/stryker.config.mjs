import { strykerConfig } from "../../stryker.config.base.mjs";

export default strykerConfig({
  mutate: ["src/**/*.ts", "!src/index.ts"],
});
