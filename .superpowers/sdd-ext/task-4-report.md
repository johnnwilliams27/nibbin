# Task 4 Report — Upload route: accept all types, store-never-drop, write new columns

**STATUS: DONE**

## What was done

- Removed `ACCEPTED_MIMES` allowlist and image-rejection block from `apps/web/app/api/brain/documents/upload/route.ts`.
- Added `classifyMime(mime): 'extractable' | 'unsupported'` function: text-native (txt/md/csv/html), PDF, docx, and `image/*` → `extractable`; pptx, xlsx, and everything else → `unsupported`.
- Sources insert now writes `mime_type`, `byte_size`, and `extraction_state` (`'pending'` for extractable, `'unsupported'` for unsupported).
- Enqueue of `source_extraction_jobs` and `extractDocument` fire-and-forget are gated on `extractable` only.
- `.doc` rejection (save-as nudge) is retained.
- 20 MB size cap retained unchanged.

## Tests

Updated `apps/web/lib/brain/upload.test.ts`:
- Test 3 (xlsx): flipped from 422 → 202, `extraction_state='unsupported'`, no job enqueued.
- Test 6 (images): flipped from 422 → 202, `extraction_state='pending'`, job enqueued.
- Added T4a: `image/png` → 202, `mime_type`/`byte_size`/`extraction_state='pending'`, job enqueued.
- Added T4b: pptx → 202, `extraction_state='unsupported'`, no job, no `extractDocument` call.
- Added T4c: >20 MB still 422 `file_too_large`.
- Added T4d: insert has exact column names `mime_type`, `byte_size`, `extraction_state`.

16/16 tests pass.

## Files changed

- `apps/web/app/api/brain/documents/upload/route.ts`
- `apps/web/lib/brain/upload.test.ts`

## Concerns

None. No migration added (P1 branch owns the ALTER). No live DB dependency in tests (Supabase fully mocked).
