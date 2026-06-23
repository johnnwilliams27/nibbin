# Task 4 Report: Extraction Proposals Append-Only

## Sites Found and Changed

| File | Site | Old `p_op` | New `p_op` |
|---|---|---|---|
| `apps/web/lib/brain/doc-extract.ts` | Per-field loop (all kinds: textnative, docx, pdf, pptx, xlsx, svg) | `(appendOnly || fieldKey === 'notes') ? 'append' : 'replace'` | `'append'` (unconditional) |
| `apps/web/lib/brain/doc-extract.ts` | Reference catch-all summary (notes field) | `'append'` | `'append'` (already correct; confirmed by regression guard test T4-3) |
| `apps/web/lib/brain/vision-extract.ts` | Vision per-field loop | `fieldKey === 'notes' ? 'append' : 'replace'` | `'append'` (unconditional) |

## Changes Made

### `apps/web/lib/brain/doc-extract.ts`
- Removed the `appendOnly` variable (was `kind === 'pptx' || kind === 'xlsx' || kind === 'svg'`).
- Changed `const op = (appendOnly || fieldKey === 'notes') ? 'append' : 'replace'` → `const op = 'append'`.
- Added rationale comment at the propose site.

### `apps/web/lib/brain/vision-extract.ts`
- Changed `const op = fieldKey === 'notes' ? 'append' : 'replace'` → `const op = 'append'`.
- Added rationale comment at the propose site.

### Test files
- `apps/web/lib/brain/doc-extract.test.ts`: Added T4-1 (txt per-field), T4-2 (docx per-field), T4-3 (catch-all regression guard).
- `apps/web/lib/brain/vision-extract.test.ts`: Added T4-vision (vision per-field). Fixed stale V7 (SVG is now `'svg'` not `'phase2'` since Task 3).

## Test Results
- 79/79 pass (including 4 new Task 4 tests; V7 updated for Task 3 SVG promotion).
- Typecheck: 2 pre-existing stale `.next/types` errors only — no new errors.
