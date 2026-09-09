import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    /**
     * These suites are CPU-bound sweeps, not I/O, and their runtime tracks the
     * machine rather than anything about correctness. jointSweep evaluates a
     * constant grid over a synthetic cohort: ~0.6s to 2.5s per test on an idle
     * developer machine, against vitest's 5s default.
     *
     * That margin is too thin for a shared runner. CI took roughly eight times
     * longer under contention and `is deterministic for a given seed and
     * cohort` — a 632ms test locally — timed out at 5000ms, failing a required
     * check for a reason that had nothing to do with the code under test.
     *
     * 30s is ~12x the slowest local test: wide enough that scheduling noise
     * cannot reach it, narrow enough that a genuinely wedged sweep still fails
     * rather than hanging the job to its own timeout. Raising the ceiling is
     * the honest fix here; making the sweep sample less would change what the
     * tests actually verify.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
