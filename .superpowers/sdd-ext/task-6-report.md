# Task 6 Report: Image vision extractor → proposal queue (fail-closed)

## Status: COMPLETE

## What was implemented

### New file: `apps/web/lib/brain/vision-extract.ts`
- Exports `extractFromImage(buffer, mime, generate, rpc, ctx): Promise<ProposalDraft[]>`
- Builds a `GenerateRequest` with `content: ContentBlock[]` — `content[0]` is an image block (base64), `content[1]` is the text extraction instruction
- Parses the model reply into structured proposals (only known KNOWN_FIELDS — derived-not-raw)
- Runs the redaction battery on the full reply text before processing fields (quarantine → zero proposals)
- Per-field defense-in-depth redaction re-check (same as text path)
- Submits each draft via `propose_memory_change` RPC with EXACT 7-arg param names: `p_account, p_field_key, p_op, p_value, p_rationale, p_source_id, p_origin`
- Throws on model error (fail-closed — caller marks failed)
- Empty/no-usable-content reply → zero proposals, no crash

### Modified: `apps/web/lib/brain/doc-extract.ts`
- Replaced the `// TODO(Task 6)` stub (image→unsupported) with the real vision path
- Image branch now: state `'extracting'` → get generate fn + route decision → download buffer → `extractFromImage` → state `'extracted'`
- On any error/throw: caught by outer catch → state `'failed'`, zero proposals (fail-closed)
- No-API-key case: marks `'extracted'` with zero proposals (consistent with text path behaviour)

### Modified: `apps/web/lib/brain/doc-extract.test.ts`
- Updated T5-5 test: image/png now expects vision path (extracted + proposals), not unsupported

### New file: `apps/web/lib/brain/vision-extract.test.ts`
- 12 tests covering: image block in request (V1), N proposals with exact param keys (V2), model error throws (V3), empty reply = zero proposals (V4/V4b), quarantine blocks all proposals (V5), raw bytes/unknown fields excluded (V6), SVG contract doc (V7), plus 4 integration tests (I1-I4) verifying doc-extract wire

## SVG handling
SVG is NOT routed to `extractFromImage`. It is classified as `'phase2'` (unsupported) by `classifyExtractor` because it requires rasterization for vision — no rasterizer dependency is available. This is tested in doc-extract.test.ts and documented in vision-extract.ts.

## Test summary
- `vision-extract.test.ts`: 12/12 pass
- `doc-extract.test.ts`: 35/35 pass
- Total: 47/47

## Typecheck
`npm run typecheck` shows ONLY the 2 known stale `.next/types` route errors:
- `apps/web/.next/types/app/api/connect/google/callback/route.ts`
- `apps/web/.next/types/app/api/cron/nibbin-schedule/route.ts`

No new type errors introduced.

## Merge note
At P6 merge, add `p_stakes: 'normal'` to the `propose_memory_change` call in both `vision-extract.ts` and `doc-extract.ts` to adopt the 8-arg RPC form. A code comment marks this in both files.
