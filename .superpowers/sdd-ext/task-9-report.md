# Task 9 Report — Gate fixes (C1/I1/I2/I3 + M3)

## Gate: 2026-06-23-sources-extraction-vision-gate.md
Verdict: CHANGES-REQUIRED → fixed all must-fix findings.

---

## C1 — PDF must be a `document` block, not an `image` block

**What changed:**
- `packages/router/src/anthropic.ts` — Added `document` variant to `ContentBlock` union:
  `{ type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }`
- `apps/web/lib/brain/vision-extract.ts` — `extractFromImage` now branches on `mime === 'application/pdf'`:
  PDF → `{ type:'document', source:{ type:'base64', media_type:'application/pdf', data } }`
  Image (png/jpeg/webp) → `{ type:'image', source:{ type:'base64', media_type, data } }` (unchanged)
- Back-compat: text-only and image requests are byte-identical; verified by existing router tests.

**Covering test:** `vision-extract.test.ts: C1. scanned PDF: content[0] is a document block` — asserts `blocks[0].type === 'document'` and `media_type === 'application/pdf'`. `C1b` asserts image/jpeg still uses `type:'image'`.
`doc-extract.test.ts: 2.` updated — now asserts `blocks[0].type === 'document'`.

**PASS:** 25 vision-extract tests + 37 doc-extract tests green.

---

## I1 — Pre-vision size ceiling

**What changed:**
- `apps/web/lib/brain/vision-extract.ts` — Added size guards before any API call:
  - Image > 5 MB: `console.warn` + return `{ proposals: [], redactionStatus: 'unsupported' }`
  - PDF > 32 MB: same
- `apps/web/lib/brain/doc-extract.ts` — Handles `redactionStatus === 'unsupported'` return from `extractFromImage`: sets `extraction_state='unsupported'` (store-never-drop semantics), marks job done.

**Covering tests:**
- `I1a. image > 5MB → no generate call, returns unsupported` — oversized buffer, mockGenerate never called, redactionStatus=unsupported ✓
- `I1b. image exactly at 5MB → proceeds (in-range)` — model called once ✓
- `I1c. PDF > 32MB → no generate call, returns unsupported` ✓

**PASS.**

---

## I2 — Record vision cost to the COGS ledger

**What changed:**
- `apps/web/lib/brain/vision-extract.ts` — `extractFromImage` accepts optional `recordModelCall?: RecordModelCallFn` + `costCtx?: VisionCostCtx` params.
  - On success: calls `recordModelCall({ ..., usage: result.usage, outcome: 'ok' })`
  - On error (before re-throw): calls `recordModelCall({ ..., usage: zeros, outcome: 'error' })`
- `apps/web/lib/brain/doc-extract.ts` — Both the image branch and scanned-PDF branch now pass `recordModelCall` (imported from `../llm/client`) + a `costCtx` to `extractFromImage`.

**Covering tests:**
- `I2a. vision success → recordModelCall hook called with usage from result` — asserts `outcome:'ok'`, `usage.inputTokens=999`, `usage.outputTokens=77` ✓
- `I2b. vision error → recordModelCall called with outcome=error + zero usage` ✓
- `I2c. no recordModelCall provided → no crash (hook is optional)` ✓
- Integration `I2 (integration). image/png: recordModelCall called with vision usage` via `extractDocument` — asserts `mockRecordModelCall2` called with correct usage ✓

**PASS.**

---

## I3 — Stop the redaction_status side effect

**What changed:**
- `apps/web/lib/brain/doc-extract.ts` — Truncated-pages logging path no longer calls `updateRedactionStatus(..., 'pending', ...)`. It now directly patches only `sources.origin` (JSONB update, no `redaction_status` field).
- `extractFromImage` now returns `{ proposals, redactionStatus }` where `redactionStatus` is `'clean' | 'redacted' | 'quarantined' | 'unsupported'`.
- Both the image branch and scanned-PDF branch in `doc-extract.ts` now call `updateRedactionStatus(svc, sourceId, visionResult.redactionStatus)` after the vision call completes, setting the terminal value.

**Covering tests:**
- `I3a. clean extraction → redactionStatus=clean` ✓
- `I3b. redacted extraction → redactionStatus=redacted` ✓
- `I3c. quarantine → redactionStatus=quarantined, zero proposals` ✓
- Integration `I3 (integration). image/png: redaction_status set to clean after vision success` — asserts no 'pending' write, terminal value is 'clean' or 'redacted' ✓
- `doc-extract.test.ts test 2` — asserts no 'pending' in redactionWrites ✓
- `doc-extract.test.ts test 9` — asserts truncated_pages payload has no `redaction_status` key, terminal status is set after vision ✓

**PASS.**

---

## M3 — Tautological SVG test fixed

**What changed:**
- `apps/web/lib/brain/vision-extract.test.ts: V7` — Replaced `expect(true).toBe(true)` with:
  ```ts
  const { classifyExtractor } = await import('./doc-extract');
  expect(classifyExtractor('image/svg+xml', 'logo.svg')).toBe('phase2');
  expect(classifyExtractor('', 'logo.svg')).toBe('phase2');
  ```
  Now asserts the actual contract (SVG → phase2) rather than being documentation-only.

**PASS.**

---

## Commands run

```
npm run lint           → PASS (0 errors)
npm run typecheck      → 2 pre-existing .next/types errors only (connect/google/callback, cron/nibbin-schedule)
npx vitest run packages/router/test/   → 142 passed (6 files)
npx vitest run apps/web/lib/brain/     → 80 passed (4 files)
```

## Total tests: 222 passed, 0 failed.

## Deferred (by task spec — DO NOT change)
- M4: `op:'replace'` whole-field overwrite — owner-gated, intended
- M5: stale-`extracting` re-drive gap — pre-existing queue concern
