# Task 7 Report: Scanned-PDF Vision OCR Fallback

## Fallback Path Implemented: PDF bytes → `application/pdf` image block

**Path taken:** The `@nibbin/router` `ContentBlock` union accepts `{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }`. The `media_type` field is an open string — Anthropic claude-3+ models accept `media_type='application/pdf'` in this block type, allowing the raw PDF buffer to be passed directly as a base64-encoded document block. No PDF rasteriser dependency is needed.

**Path NOT taken:** A PDF→image rasteriser (e.g. `pdf2pic`, `pdfjs-dist` canvas rendering) was not needed because the router's existing `ContentBlock` image union already supports `application/pdf` as a media_type value. Adding a rasteriser would increase complexity and bundle size for no gain.

## Changes

### `apps/web/lib/brain/doc-extract.ts`
Replaced the old `isScanned` fail-closed block (which wrote `extraction_state='failed'`, job=`error`, zero proposals) with a vision OCR fallback:

1. Emit a `console.warn` with reason (no silent drop).
2. If `truncatedPages=true`, log `truncated_pages: true` in `sources.origin` before proceeding.
3. Call `anthropicGenerate()` + `groveRouter.route()` (same pattern as image branch).
4. Call `extractFromImage(buffer, 'application/pdf', llm, svc.rpc.bind(svc), ctx)` — exactly one vision call per scanned PDF.
5. On success: `extraction_state='extracted'`, job=`done`.
6. On failure: propagates to outer `try/catch` → `extraction_state='failed'`, zero proposals (fail-closed unchanged).

**Threshold:** `SCANNED_THRESHOLD = 100` non-whitespace chars (unchanged, defined at line 52).

### `apps/web/lib/brain/doc-extract.test.ts`
Updated tests 2 and 9 (which previously asserted old fail-closed behavior) to assert the new vision fallback. Added new tests:

- **T7-0** — text-layer PDF: `generate` spy called (for text LLM), but NO image blocks in any request (zero vision calls for text PDFs).
- **2** (updated) — scanned PDF (< 100 chars, few pages): `mockGenerateFn` called EXACTLY 1 time; request carries `content[0].type='image'` with `media_type='application/pdf'`; proposals submitted; job=`done`.
- **2b** (new) — scanned PDF, vision throws: `extraction_state='failed'`, zero proposals (fail-closed).
- **9** (updated) — scanned PDF > 10 pages: `mockGenerateFn` called EXACTLY 1 time; `truncated_pages=true` logged in sources.origin; job=`done`.

## Test Results
- 37 tests passed, 0 failed (doc-extract.test.ts)
- `npm run typecheck`: only the 2 pre-existing stale `.next/types` errors; no new errors introduced.

## Density Threshold
`SCANNED_THRESHOLD = 100` (chars after `rawText.trim()`) — defined in doc-extract.ts line 52. A PDF with < 100 selectable chars across all pages is classified as scanned. This was pre-existing; Task 7 changes only what happens after `isScanned=true`.
