# Task 5 Report — doc-extract type-router dispatch + state transitions

## Status: COMPLETE

## Files Modified
- `apps/web/lib/brain/doc-extract.ts` — added `classifyExtractor`, `updateExtractionState`, text-native branch, refactored dispatch, wired extraction_state lifecycle
- `apps/web/lib/brain/doc-extract.test.ts` — added 22 new tests (classifyExtractor mapping + extractDocument state transitions); updated import to include `classifyExtractor`

## What was implemented

### 1. `classifyExtractor(mime, filename): 'textnative'|'docx'|'pdf'|'image'|'phase2'|'unknown'`
Pure exported function. Maps:
- text/plain, text/markdown, text/csv, text/html → `textnative`
- application/pdf / .pdf extension → `pdf`
- docx MIME / .docx extension → `docx`
- image/png, image/jpeg, image/webp → `image`
- image/svg+xml → `phase2` (SVG needs rasterizer for vision; documented in JSDoc)
- pptx/xlsx MIMEs or extensions → `phase2`
- anything else → `unknown`

### 2. `updateExtractionState` helper
Best-effort DB write to `sources.extraction_state`. Called at each lifecycle point.

### 3. State transitions in `extractDocument`
- `extracting` written immediately at entry (before any extractor work)
- `extracted` written on success
- `unsupported` written for phase2 / unknown / image (Task 6 seam)
- `failed` written on any extractor throw (fail-closed, zero proposals)
- Scanned PDF path now also writes `failed` (was only writing `error` job status before)

### 4. Text-native branch
`kind === 'textnative'` → `buffer.toString('utf8').slice(0, RAW_TEXT_CAP)` using existing cap/strip pipeline.

### 5. Image seam (Task 6 placeholder)
`kind === 'image'` → writes `unsupported` with `// TODO(Task 6): wire extractFromImage`.
Task 6 will flip this to the vision path. Tests assert the unsupported state so Task 6 just needs to flip one test expectation.

## Tests
35 total (13 pre-existing + 22 new): 35 passed, 0 failed.
- 16 classifyExtractor mapping assertions covering all 6 return values
- 6 extractDocument state-transition tests (docx happy path, pptx→unsupported, throw→failed, text-native, image→unsupported, unknown→unsupported)

## Typecheck
Pre-existing errors (from Tasks 1-3: synthesis.test.ts mock type + Next.js .next/types generated) unchanged. Zero new errors introduced by Task 5.
