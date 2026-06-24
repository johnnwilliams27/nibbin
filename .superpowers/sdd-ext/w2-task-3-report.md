# Wave 2 Task 3 Report — Full-Suite Green

**Date:** 2026-06-23  
**Branch:** feature/company-brain-memory-redesign  
**Worktree:** C:\nib-p1

## Commands Run

```
npm run lint
npm run typecheck
npx vitest run apps/web/app/app/memory apps/web/app/api/brain/sources
```

## Results

### Lint
PASS — no errors, no output (eslint clean).

### Typecheck
All 8 errors are **pre-existing** (not touched by Tasks 1–2):

| File | Error | Evidence |
|------|-------|----------|
| `apps/web/.next/types/app/api/connect/google/callback/route.ts` | TS2344 stale `.next/types` | `git diff origin/main...HEAD -- <file>` → empty (file not in branch diff) |
| `apps/web/.next/types/app/api/cron/nibbin-schedule/route.ts` | TS2344 stale `.next/types` | same |
| `apps/web/app/WebAnalytics.tsx` | TS2307 `@vercel/analytics/next` not found; TS7006 implicit-any | same |
| `apps/web/lib/planner/browser.ts` | TS2307 `@sparticuz/chromium` not found | same |
| `apps/web/lib/planner/sparticuz-args.test.ts` (×3) | TS2307 `@sparticuz/chromium` | same |

These match the documented known pre-existing errors exactly.

### Test Suite
**27 test files, 619 tests — all PASS**  
Duration: ~10s  
Suites: `apps/web/app/app/memory` + `apps/web/app/api/brain/sources`

## Invariant Confirmations

1. **Drag-drop upload** — intact. `SourcesLibrary.tsx` has `onDrop={testMode ? undefined : handleDrop}`, native DnD + `<input type="file">` fallback confirmed at lines 195–298.

2. **Extraction-state chips** — intact. Chip labels (`extracting: 'Reading'`, `failed: 'Failed'`, etc.) at lines 64–66; chip filter drives `state.state` in reducer.

3. **Reference catch-all** — intact. `SourcesTab.tsx` renders `<ReferenceCatchAll>` below `<SourcesLibrary>` (line 85); confirmed placement is below the library.

4. **Filter/sort/search drives server refetch** — confirmed. `useEffect` at line 147 keyed on `[group, state, q, sort, dir, offset, limit]` builds query string and calls `/api/brain/sources?…`. Client-side narrowing removed (comment at line 280: "server is source of truth"). `group='other'` predicate fix in `sourcesQuery.ts` maps to NOTIN all known MIME patterns.

## Fixes Applied
None required — suite was already green from Tasks 1–2.

## Remaining Red
None introduced by this wave. All typecheck errors are pre-existing (proven by empty `git diff origin/main...HEAD` for each affected file).
