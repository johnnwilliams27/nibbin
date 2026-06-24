/**
 * Vitest wrapper for the live vision smoke script.
 *
 * This suite is SKIPPED when RUN_LIVE_VISION !== '1'.
 * In CI (no env flag, no API key) it produces zero test runs and exits 0.
 * No network call is made when the flag is unset.
 *
 * To run live:
 *   RUN_LIVE_VISION=1 ANTHROPIC_API_KEY=sk-ant-… npx vitest run scripts/live-vision-smoke.test.ts
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

const RUN_LIVE = process.env.RUN_LIVE_VISION === '1';

describe.skipIf(!RUN_LIVE)('live vision smoke (real API, opt-in)', () => {
  it('both image and document blocks are accepted by the API', () => {
    // Invoke the script as a subprocess so its process.exit() calls are
    // isolated from the vitest process.  The script prints PASS/FAIL and
    // exits 0 on success or 1 on failure.
    // spawnSync with an explicit argv array — no shell interpolation.
    const result = spawnSync(
      'npx',
      ['tsx', 'scripts/live-vision-smoke.ts'],
      {
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'inherit',
      },
    );

    expect(result.status).toBe(0);
  });
});
