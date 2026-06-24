# Sources Library: Server-Side Filter/Sort/Search Refetch (P1) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make the Sources library filter/sort/search across ALL of an account's files (server-side), not just the 50 most-recent it currently fetches and filters in the browser; add "load more" paging; fix the `group='other'` predicate.

**Architecture:** The `GET /api/brain/sources` route already parses `group/state/q/sort/dir/limit/offset` (Task 8). The library currently fetches once with no params and narrows client-side. Rewire so changing a chip/search/sort triggers a refetch WITH those params, and "load more" appends the next offset page.

**Tech Stack:** Next.js 15 (RSC + client island), TypeScript, vitest (`renderToStaticMarkup` + pure reducer; fetch mocked).

## Global Constraints
- The reducer stays the single source of UI state; the component is a dumb renderer.
- Server is the source of truth for the filtered/sorted result set; do NOT keep client-side narrowing that contradicts the server page (it caused the "images beyond the newest 50 are invisible" bug).
- Preserve the existing extraction-state chips, drag-drop upload, and the Reference catch-all below the library.
- `group='other'` must mean "mime not in any known group", not a pass-through.

---

### Task 1: `group='other'` predicate fix (server)
**Files:** Modify `apps/web/app/app/memory/sourcesQuery.ts` and/or `apps/web/app/api/brain/sources/route.ts`; Test: extend `sourcesQuery.test.ts` / `route.test.ts`.
**Interfaces:** the query builder must translate `group='other'` into a predicate that EXCLUDES all known-group mime patterns (docs/images/sheets/slides/web), rather than applying no predicate. Provide a pure helper `groupToMimePredicate(group): { kind: 'in'|'notin'|'none', patterns: string[] }` (or equivalent) so it's unit-testable without the DB.
- [ ] Failing tests — `group='images'` → predicate matching `image/*`; `group='other'` → predicate EXCLUDING all known group mimes (asserts a known mime like `application/pdf` would NOT match `other`, and an unknown mime like `application/x-thing` WOULD). → FAIL → implement → PASS → commit.

### Task 2: server-side refetch + load-more (client)
**Files:** Modify `apps/web/app/app/memory/sourcesLibrary.reducer.ts`, `apps/web/app/app/memory/SourcesLibrary.tsx`; Test: extend `sourcesLibrary.reducer.test.ts`, `SourcesLibrary` render tests.
**Interfaces:** reducer state gains `{ offset, hasMore, loading }`. New actions: `REQUEST(params)` (sets loading), `LOAD_OK({ items, append, hasMore })` (replaces on a new filter/sort/search; APPENDS on load-more), `LOAD_MORE`. `SET_FILTER/SET_QUERY/SET_SORT` now RESET offset to 0 and signal a refetch (they no longer narrow client-side). The component builds the query string from state (`group,state,q,sort,dir,limit,offset`) and refetches in a `useEffect` keyed on those; a "Load more" control dispatches `LOAD_MORE` (offset += limit) when `hasMore`.
- [ ] Step 1: failing reducer tests — `SET_FILTER('images')` resets offset to 0 and marks loading; `LOAD_OK` with `append:false` REPLACES items; `LOAD_OK` with `append:true` APPENDS; `hasMore` reflects whether a full page returned; debounced `SET_QUERY` updates the query and resets offset.
- [ ] Step 2: FAIL. Step 3: implement; the component constructs `?group=&state=&q=&sort=&dir=&limit=&offset=` from state and refetches on change (debounce the search input); "Load more" appends. Remove the old client-side narrowing. Keep `testMode` working (skip fetch, seed items). Step 4: PASS (render tests: empty, populated, "Load more" visible when hasMore, hidden when not). Step 5: commit.

### Task 3: full-suite green
- [ ] `npm run lint`, `npm run typecheck`, memory + sources suites green (except the 4 known pre-existing worktree errors). Confirm Reference catch-all + drag-drop + state chips intact; no order-dependent test assumptions. Verify each red against `git diff origin/main...HEAD`. Commit `chore: green (sources server-side filter)`.

## Merge notes
- No migration. Pure UI + query-builder change. The `GET /api/brain/sources` param contract is unchanged (already supports these params).
