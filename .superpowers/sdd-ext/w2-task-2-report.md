# Task 2 Report: xlsx text extractor

**Status:** DONE  
**Branch:** feature/company-brain-docs-ingest

## What was built

### `apps/web/lib/brain/office-extract.ts`
Added `extractXlsxText(buffer: Buffer): Promise<string>`:
- Unzips the buffer with `fflate.unzipSync`
- Parses `xl/sharedStrings.xml` into an ordered string array via regex (handles simple `<si><t>` and rich-text `<r><t>` runs)
- Collects all `xl/worksheets/sheet<N>.xml` entries, sorts by numeric index
- Resolves each `<c>` cell: `t="s"` → shared-string lookup, `t="inlineStr"` → `<is><t>` text, other → literal `<v>` value
- Joins cells with tabs, sheets with newlines, caps at 50 000 chars
- Empty workbook → `''`

### `apps/web/lib/brain/doc-extract.ts`
- Added `XLSX_MIME` constant; removed xlsx from `PHASE2_MIMES`
- `classifyExtractor` return type now includes `'xlsx'`; new branch `if (mime === XLSX_MIME || ext === 'xlsx') return 'xlsx'`
- `extractDocument` dispatch: mirrors pptx pattern — extract → empty → `unsupported`; non-empty → redaction battery → append-only proposals (`p_op:'append'`) → `extracted`; throw → `failed`
- `appendOnly` flag set for both `pptx` and `xlsx` kinds

## Tests

**office-extract.test.ts** — 8 new tests for `extractXlsxText`:
shared-string cells, inline-string cells, numeric/literal cells, empty workbook → `''`, workbook with sheets but no cells → `''`, 50k cap, multiple sheets, mixed cell types

**doc-extract.test.ts** — updates:
- `classifyExtractor` xlsx test: `'phase2'` → `'xlsx'`; added `.xlsx` extension fallback test
- 4 new integration tests (T2-1 through T2-4): xlsx happy path with append-only proposals, empty xlsx → unsupported, corrupt xlsx → failed, `.xlsx` extension dispatch

**Total: 59 tests passing (13 new)**

## Typecheck

Only the 2 known pre-existing `.next/types` stale route errors — no new errors introduced.
