# Task 6 Report — opt-in live vision smoke test

## Status
DONE

## Files created / modified
- `scripts/live-vision-smoke.ts` — standalone opt-in smoke script
- `scripts/live-vision-smoke.test.ts` — vitest wrapper (skipIf not opt-in)
- `vitest.config.ts` — added `scripts/**/*.test.ts` to include patterns

## What was built

### `scripts/live-vision-smoke.ts`
Standalone script that:
1. Guards on `process.env.RUN_LIVE_VISION === '1'` AND `process.env.ANTHROPIC_API_KEY` — prints "skipped …" and exits 0 otherwise (zero network cost in CI).
2. Sends a genuine 1×1 red-pixel PNG as an `image` content block.
3. Sends a minimal valid one-page PDF as a `document` content block.
4. Both calls use `maxTokens: 8` and model `claude-haiku-4-5-20251001` to minimise cost.
5. Uses `Promise.all` — both blocks are tested in parallel.
6. Asserts neither call throws `AnthropicApiError` with `status === 400` (API acceptance check).
7. Prints `PASS` / `FAIL` per block and exits 0 / 1 accordingly.

### `scripts/live-vision-smoke.test.ts`
- `describe.skipIf(!RUN_LIVE)` wraps the single test — CI skips the entire suite.
- Uses `spawnSync` (no shell interpolation) to run the script as a subprocess, isolating `process.exit()` calls.
- Asserts `result.status === 0`.

## CI behaviour
```
npx vitest run scripts/live-vision-smoke.test.ts
# → Test Files  1 skipped (1)
# → Tests  1 skipped (1)
# (0 network calls, exit 0)
```

## Manual live command
```bash
RUN_LIVE_VISION=1 ANTHROPIC_API_KEY=sk-ant-… npx tsx scripts/live-vision-smoke.ts
```

Expected output:
```
[live-vision-smoke] running against model claude-haiku-4-5-20251001 …
[live-vision-smoke] PASS  image/png  (image block)
[live-vision-smoke] PASS  application/pdf (document block)
[live-vision-smoke] ALL PASS
```

Or via vitest:
```bash
RUN_LIVE_VISION=1 ANTHROPIC_API_KEY=sk-ant-… npx vitest run scripts/live-vision-smoke.test.ts
```

## Typecheck
`npm run typecheck` produces exactly the 2 pre-existing stale `.next/types` errors and nothing new.
`npx tsx scripts/live-vision-smoke.ts` (without env) runs cleanly: skip message + exit 0.

## Cost estimate
Two API calls × 8 output tokens each via claude-haiku-4-5-20251001 ≈ negligible ($0.00001).
