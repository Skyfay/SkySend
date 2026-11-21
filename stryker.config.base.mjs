// Shared settings of the mutation tests. Stryker changes the code of a package in small ways,
// one mutant at a time, and checks that a unit test fails for each change. A mutant that
// survives marks code whose tests would not notice if it broke.
//
// Each package that runs them has a stryker.config.mjs that calls this with what to mutate.
// `pnpm test:mutation` runs the crypto package, `pnpm test:mutation:all` every package, see
// docs/developer-guide/reference/testing.md.

/** The shared settings, with the options of the package on top. */
export function strykerConfig(options) {
  return {
    testRunner: "vitest",
    plugins: ["@stryker-mutator/vitest-runner"],
    // Stryker runs Vitest in worker threads unless told otherwise. Vitest itself uses child
    // processes, and some tests rely on that, such as the client tests that set HOME.
    vitest: { pool: "forks" },
    // Runs for each mutant only the tests that reach its code.
    coverageAnalysis: "perTest",
    reporters: ["clear-text", "progress", "html", "json"],
    htmlReporter: { fileName: "reports/mutation/index.html" },
    jsonReporter: { fileName: "reports/mutation/mutation.json" },
    tempDirName: ".stryker-tmp",
    timeoutMS: 10_000,
    ...options,
  };
}
