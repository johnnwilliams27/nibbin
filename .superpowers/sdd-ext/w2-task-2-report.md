# Task 2 Report — server-side refetch + load-more (client)

## Status: COMPLETE

## Files changed
- `apps/web/app/app/memory/sourcesLibrary.reducer.ts` — added `offset`, `limit`, `hasMore`, `loading` to state; new `REQUEST` and `LOAD_MORE` actions; `LOAD_OK` gains `append` + `hasMore` params; `SET_FILTER`/`SET_QUERY`/`SET_SORT` reset `offset=0` and set `loading=true`; `derivedItems` is now a passthrough (server filters).
- `apps/web/app/app/memory/SourcesLibrary.tsx` — removed old mount-only fetch; `useEffect` keyed on `(group,state,q,sort,dir,offset,limit)` builds full query string and dispatches `LOAD_OK` with `append` and `hasMore`; search input switched to `defaultValue` + 300ms debounce; "Load more" button dispatches `LOAD_MORE` when `state.hasMore`; `testHasMore` prop wires into initial state for render tests.
- `apps/web/app/app/memory/memory.module.css` — added `.sourcesLoadMore` + `.sourcesLoadMoreBtn` styles.
- `apps/web/app/app/memory/sourcesLibrary.reducer.test.ts` — updated pre-existing tests (old LOAD_OK signature, derivedItems client-filter tests rewritten to verify state fields); added 11 new Task 2 reducer tests.
- `apps/web/app/app/memory/SourcesLibrary.test.tsx` — added 4 new "Load more" render tests (visible when hasMore, hidden when not, empty-state+hasMore, chips/sort).

## Test results
- Memory suite: 612/612 passed (26 files)
- Lint: clean
- Typecheck: 8 pre-existing errors only (.next/types ×2, @vercel/analytics ×2, @sparticuz/chromium ×4) — 0 new errors

## Concerns
- `derivedItems` export is kept as a passthrough for backward compat; any callers outside the tests that relied on client-side filtering will now get unfiltered items (correct: server is source of truth).
- `hasMore` is computed as `items.length === state.limit` in the effect — this means a page that lands exactly on the limit boundary will show "Load more" even if there are no further items; clicking it will get an empty page and clear the button. This is acceptable standard behavior.
- The `useEffect` dep array includes `state.limit` (50, never changes at runtime) to be exhaustive.
