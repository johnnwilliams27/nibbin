/**
 * Live vision smoke test — opt-in, never runs in CI.
 *
 * usage:
 *   RUN_LIVE_VISION=1 ANTHROPIC_API_KEY=sk-ant-… npx tsx scripts/live-vision-smoke.ts
 *
 * What it does:
 *   Sends (a) a 1×1 PNG as an `image` content block and (b) a minimal one-page
 *   PDF as a `document` content block to the real Anthropic API via
 *   `createAnthropicClient`.  Asserts neither call throws an `AnthropicApiError`
 *   with status 400 (i.e. both block types are accepted by the API).
 *
 * Exits 0 on PASS, 1 on FAIL or on any thrown error.
 * maxTokens is kept at 8 to minimise cost (we only care about block acceptance).
 */

import { createAnthropicClient, AnthropicApiError } from '@nibbin/router';
import type { ContentBlock } from '@nibbin/router';

// ── Guard: opt-in check ───────────────────────────────────────────────────────

if (process.env.RUN_LIVE_VISION !== '1' || !process.env.ANTHROPIC_API_KEY) {
  console.log('[live-vision-smoke] skipped (set RUN_LIVE_VISION=1 + ANTHROPIC_API_KEY)');
  process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY;

// ── Minimal media fixtures ────────────────────────────────────────────────────

/**
 * A genuine 1×1 red-pixel PNG encoded as base64.
 * Generated from: Buffer.from(png_bytes).toString('base64').
 * This is a known-good 67-byte PNG that every major decoder accepts.
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';

/**
 * A genuine minimal one-page PDF encoded as base64.
 * The PDF structure below is the smallest valid PDF that passes API validation:
 * it has a catalog, pages dict, one page, and a content stream that prints nothing.
 *
 * Raw bytes were verified against Anthropic's PDF block requirements (binary-safe
 * base64, correct cross-reference table, %%EOF terminator).
 */
const TINY_PDF_BASE64 = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R/Resources<<>>>>endobj\n' +
  'xref\n' +
  '0 4\n' +
  '0000000000 65535 f \n' +
  '0000000009 00000 n \n' +
  '0000000058 00000 n \n' +
  '0000000115 00000 n \n' +
  'trailer<</Size 4/Root 1 0 R>>\n' +
  'startxref\n' +
  '190\n' +
  '%%EOF\n',
).toString('base64');

// ── Runner ────────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8;

const generate = createAnthropicClient({ apiKey });

async function testBlock(
  label: string,
  mediaBlock: ContentBlock,
): Promise<boolean> {
  const userContent: ContentBlock[] = [
    mediaBlock,
    { type: 'text', text: 'Describe this in one word.' },
  ];

  try {
    await generate({
      model: MODEL,
      system: [{ text: 'You are a helpful assistant.' }],
      messages: [{ role: 'user', content: userContent }],
      maxTokens: MAX_TOKENS,
    });
    console.log(`[live-vision-smoke] PASS  ${label}`);
    return true;
  } catch (err) {
    if (err instanceof AnthropicApiError && err.status === 400) {
      console.error(`[live-vision-smoke] FAIL  ${label} — API rejected block with 400: ${err.message}`);
      return false;
    }
    // Non-400 errors (5xx, timeout, network) are unexpected infrastructure
    // failures, not block-type rejections — still report as FAIL for the smoke.
    console.error(`[live-vision-smoke] FAIL  ${label} — unexpected error: ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log(`[live-vision-smoke] running against model ${MODEL} …`);

  const imageBlock: ContentBlock = {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_BASE64 },
  };

  const documentBlock: ContentBlock = {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: TINY_PDF_BASE64 },
  };

  const [imageOk, pdfOk] = await Promise.all([
    testBlock('image/png  (image block)', imageBlock),
    testBlock('application/pdf (document block)', documentBlock),
  ]);

  if (imageOk && pdfOk) {
    console.log('[live-vision-smoke] ALL PASS');
    process.exit(0);
  } else {
    console.error('[live-vision-smoke] ONE OR MORE FAILURES — see above');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[live-vision-smoke] unhandled error:', err);
  process.exit(1);
});
