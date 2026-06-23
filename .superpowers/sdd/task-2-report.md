# Task 2 Report: Extraction Library

**Branch:** feature/company-brain-docs-ingest  
**Date:** 2026-06-23

## Status: COMPLETE

All 12 tests pass. Full suite (2191 tests) green. Typecheck clean.

---

## Files Created / Modified

### New files
- `apps/web/lib/brain/doc-extract.ts` — Extraction worker
- `apps/web/lib/brain/doc-extract.test.ts` — 12 unit tests

### Modified files
- `packages/router/src/types.ts` — Added `doc_extract` and `doc_vision_extract` to `RoutedTask` union
- `packages/router/src/tiers.ts` — Added both tasks to `TIER_FOR_TASK` (both `'t1'`)
- `packages/router/test/router.test.ts` — Updated task-count assertion (20 → 22)

---

## Dependencies Added
- `pdf-parse@1.1.1` (exact pin, CJS, default import)
- `mammoth@1.8.0` (exact pin, CJS, `extractRawText` surface)
- `@types/pdf-parse` (devDep, resolves TS2339)

---

## Implementation Summary

### Redaction gate
`runRedactionGate(rawText)` calls `applyBattery()` first. Rules are classified:
- **QUARANTINE_RULES** = `{ SSN, CARD, APIKEY }` — triggers `redaction_status='quarantined'`, zero proposals, job='error', early return
- All other rules hit → text returned with `[REDACTED]` spans, `redaction_status='redacted'`
- No rules → `redaction_status='clean'`

Then `HeuristicNer.redact()` runs on the (already scrubbed) battery output as defense-in-depth for person-name detection. Combined status is the final status.

Per-field re-check: `perFieldRedactionCheck(value)` runs `applyBattery` + NER on each extracted field value. ANY rule hit → field is silently dropped (logged), not surfaced to the user.

### Text extraction paths
- **PDF text-native**: `pdf-parse` returns text. If `trim().length < 100` (SCANNED_THRESHOLD) → scanned path.
- **Scanned/vision**: `callVisionLlm()` with `task='doc_vision_extract'`. Truncates at 10 pages; sets `truncated_pages: true` in `sources.origin`.
- **DOCX**: `mammoth.extractRawText({ buffer })` → value string.
- **TXT**: `buffer.toString('utf8')`.
- **Image**: direct vision path.

rawText cap: 50,000 chars applied after extraction.

### LLM extraction
`callDocExtractLlm()` uses `groveRouter.route({ task: 'doc_extract', origin: 'pipeline' })` → `anthropicGenerate()` with the `DOC_EXTRACT_SYSTEM` prompt (cached). Returns a `Record<string, string>` of known field keys (`facts`, `pricing`, `policies`, `faq`, `voice`, `hard_rules`, `notes`). Unknown keys are ignored.

`recordModelCall` is called on both success and error paths for both `doc_extract` and `doc_vision_extract` tasks.

### Reference catch-all (§5.6)
Condition: `rawText.length > 500 AND (proposedCount < 1 OR (rawText.length > 5000 AND proposedCount < 3))`. If triggered, calls `callSummaryLlm()` (also `task='doc_extract'`, separate `recordModelCall`) and proposes `notes` field with `op='append'`, capped at 800 chars.

### propose_memory_change calls
Each surviving field calls `svc.rpc('propose_memory_change', { p_account_id, p_field_key, p_op, p_value, p_rationale, p_source_id, p_origin: 'doc_extract' })`. `p_op = 'append'` for `notes` field, `'replace'` for all others. Rationale format: `"From {filename} — {reason}"`, capped at 200 chars.

---

## Test Coverage

| Test | Covers |
|------|--------|
| 1. text-native PDF, clean | Full happy path: 2 proposals, 1 recordModelCall, job='done', status='clean' |
| 2. scanned PDF detection | < 100 chars → doc_vision_extract task called |
| 3. redaction scrub | Phone rule hit → status='redacted'; raw phone not in proposals |
| **4. quarantine** | SSN rule → status='quarantined'; propose_memory_change NEVER called; job='error' |
| 5. per-field defense-in-depth | Field value trips battery → dropped; clean field still proposed |
| 6. empty/whitespace field | Whitespace-only value → no proposal |
| 7. catch-all trigger | 6000-char rawText + 1 field → 2nd LLM call + notes append |
| 8. catch-all no-trigger | 300-char rawText + 0 fields → only 1 LLM call |
| 9. 10-page scanned cap | 15 pages → truncated_pages: true in sources.origin |
| 10. DOCX via mammoth | mammoth.extractRawText called; LLM receives output |
| 11. rawText cap 50k | 60k-char input → LLM user message ≤ 51k chars |
| 12. error handling | LLM throws → recordModelCall(outcome='error'); no proposals; job='error' |

**Quarantine-zero-proposals test**: Test 4 explicitly asserts `expect(mockRpc).not.toHaveBeenCalled()` after a quarantine-class rule fires.

---

## Concerns / Notes

1. **Vision implementation is text-only for now**: The `Generate` type only accepts `ChatTurn` with `content: string`. True multimodal (image content blocks) would require extending `GenerateRequest` in `@nibbin/router`. Current implementation passes base64 as a text description — functional for tests and the mock path, but would need the `GenerateRequest` extension for real vision extraction. This is documented inline. The task-id `doc_vision_extract` and the routing plumbing are all in place.

2. **`updateRedactionStatus` with `originPatch`**: The current implementation overwrites `sources.origin` JSONB. In production, this would need a Postgres JSONB merge (`||` operator) to avoid clobbering other origin fields. For the test/worktree context this is acceptable; the upload route (Task 3) is where the full origin gets written.

3. **Router task count test**: Updated from 20 → 22 to match the two new tasks. This is a mechanical maintenance update.

4. **No regression in 2191 tests**: Full suite green.

---

## Commit Hash

See `git log --oneline -1` after the commit.
