# Task 1 Report: pptx text extractor

**Status:** COMPLETE — all tests green, typecheck clean (2 pre-existing `.next/types` stale errors unchanged).

## What was done

### Files changed
- `apps/web/package.json` — added `fflate@^0.8.3` (resolved from `^0.8.2`)
- `apps/web/lib/brain/office-extract.ts` — NEW: `extractPptxText(buffer: Buffer): Promise<string>` using `unzipSync`/`strFromU8` from fflate; reads `ppt/slides/slide*.xml` in numeric order, extracts `<a:t>…</a:t>` runs, caps at 50 000 chars; empty/no-slides → `''`
- `apps/web/lib/brain/doc-extract.ts` — `classifyExtractor` returns `'pptx'` for pptx mime/`.pptx` extension (not `'phase2'`); added `pptx` to return-type union; pptx dispatch: extract → if empty → `unsupported`; if non-empty → redaction gate → append-only LLM proposals → `extracted`; throws → `failed` (fail-closed); `appendOnly` flag scopes append to pptx path without disturbing existing pdf/docx/textnative behaviour
- `apps/web/lib/brain/office-extract.test.ts` — NEW: 6 unit tests using in-memory fflate `zipSync` fixtures (single slide, multi-slide, no-slides, no-text, cap, numeric order)
- `apps/web/lib/brain/doc-extract.test.ts` — updated: pptx classifier tests now expect `'pptx'` (not `'phase2'`); added `mockExtractPptxText` mock; T5-2 updated to empty-pptx→unsupported; added T5-2b (pptx-with-text → extracted + all proposals p_op='append') and T5-2c (pptx-throw → failed)

## Test summary

- `office-extract.test.ts`: 6/6 pass
- `doc-extract.test.ts`: 40/40 pass (up from 37; +3 new pptx scenarios)
- Full brain suite: 89/89 pass across 5 test files

## Concerns

None blocking. Two pre-existing `.next/types` stale route errors are unchanged and expected (plan Task 7 allowlists them).
