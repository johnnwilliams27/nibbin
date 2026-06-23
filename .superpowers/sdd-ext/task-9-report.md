# Task 9 Report — Sources Library UI (drag-drop + list + search/filter/sort)

## Status: COMPLETE

## Files created
- `apps/web/app/app/memory/sourcesLibrary.reducer.ts` — pure reducer: `{q,group,state,sort,dir,items,uploading}` + `SET_QUERY/SET_FILTER/SET_SORT/UPLOAD_START/UPLOAD_DONE/LOAD_OK` actions + `derivedItems()` helper
- `apps/web/app/app/memory/SourceRow.tsx` — type icon + title + size + captured date + extraction-state chip (5 states)
- `apps/web/app/app/memory/SourcesLibrary.tsx` — drag-drop zone (native DnD + `<input type="file">` fallback) + file list + search box + filter chips (by mimeGroup + by extraction state) + sort control; loads via `GET /api/brain/sources`; testMode prop for static render tests
- `apps/web/app/app/memory/sourcesLibrary.reducer.test.ts` — 24 reducer unit tests (all pass)
- `apps/web/app/app/memory/SourceRow.test.tsx` — 22 render tests via renderToStaticMarkup (all pass)
- `apps/web/app/app/memory/SourcesLibrary.test.tsx` — 23 render tests (empty/populated/uploading + Reference still renders)

## Files modified
- `apps/web/app/app/memory/SourcesTab.tsx` — mounted `<SourcesLibrary />` ABOVE the existing Reference catch-all (Reference + EvidenceList unchanged)
- `apps/web/app/app/memory/memory.module.css` — added CSS tokens for sourcesLibrary, sourceRow, state chips (all reuse existing design tokens)

## Test results
- Memory suite: 584/584 tests pass (26 test files)
- No new tests fail; no pre-existing tests broken

## Typecheck
- 8 errors total, all pre-existing known errors:
  - `.next/types` ×2 (OmitWithTag constraint)
  - `@vercel/analytics` ×2 (module not found + implicit any)
  - `@sparticuz/chromium` ×4 (module not found)
- Zero new errors introduced

## Concerns
- None. The upload endpoint (`POST /api/brain/documents/upload`) is in the P2 worktree as planned; the component posts to that path and tests mock fetch via testMode.
- SET_SORT toggles dir correctly; SET_FILTER narrows the derived list; UPLOAD_START/DONE work as specified.
- "Retained — not yet read" (unsupported) and all 5 state chips tested and passing.
