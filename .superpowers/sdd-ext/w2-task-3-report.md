# Task 3 Report: SVG Text Extractor

## Status: COMPLETE

## What was done

### `office-extract.ts` — added `extractSvgText(buffer: Buffer): string`
- Decodes the buffer as UTF-8 (SVG is plain XML — no unzip needed)
- Extracts text content from `<text>`, `<title>`, and `<desc>` elements using a single regex with backreference (`<(text|title|desc)[^>]*>([\s\S]*?)<\/\1>`)
- Strips nested tags (e.g. `<tspan>`, `<a>`) from element content via `replace(/<[^>]*>/g, ' ')`
- Collapses whitespace and trims each block
- Joins with spaces; caps at RAW_TEXT_CAP (50 000 chars)
- Returns `''` if no text-bearing elements found

### `doc-extract.ts` — wired svg kind
- `classifyExtractor` return type extended to include `'svg'`
- `image/svg+xml` and `.svg` extension now return `'svg'` (removed from `'phase2'`)
- Added `extractSvgText` to the import from `./office-extract`
- Added `kind === 'svg'` branch in the dispatch: calls `extractSvgText` (synchronous); empty → `unsupported`; non-empty → full redaction + LLM + append-only proposals → `extracted`; throw → outer catch → `failed`
- `appendOnly` flag now covers `svg` alongside `pptx` and `xlsx`

## Tests

- `office-extract.test.ts`: 6 new svg tests (title+text extraction, desc, empty svg, whitespace-only, cap, nested tag stripping) — all pass
- `doc-extract.test.ts`:
  - Updated tautological `image/svg+xml → phase2` test to `→ svg` + added `.svg extension fallback` test
  - Added `extractSvgText` to the office-extract mock
  - 4 new integration tests: T3-1 (svg with text → append-only proposals → extracted), T3-2 (empty svg → unsupported), T3-3 (.svg extension dispatch), T3-4 (extractor throws → failed)
  - **70 tests total across both files — all pass**

## Typecheck
- Only 2 known stale `.next/types` errors (pre-existing; not caused by this task)

## Concerns
- None. The regex-based approach is sufficient for SVG text extraction (SVG text elements are shallow; full XML parsing would be over-engineering for this use case).
