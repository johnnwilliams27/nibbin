# Task 6 — Google Calendar Incremental Sync: Fix Report

**Date:** 2026-06-20  
**Branch:** feature/connector-lever1  
**Base commit:** ee3336f0

---

## Fixes Applied

### Fix 1 — Pagination (Important)

**File:** `packages/connectors/src/connectors/calendar-delta.ts`

Added `pageToken?: string` to `CalendarDeltaDeps.listSync`. Introduced `accumulatePages()` helper that loops until `nextPageToken` is absent, accumulating items across all pages and taking `nextSyncToken` from the final page only. The single-call `res = await deps.listSync(prior)` pattern is replaced with this loop throughout.

**File:** `apps/web/app/api/cron/connector-poll/route.ts`

Updated the `listSync` closure to forward `pageToken` to `client.listEventsSync('primary', syncToken, pageToken)` and include `nextPageToken` in the returned object. `GoogleCalendarClient.listEventsSync` already accepted `pageToken` — the gap was the delta abstraction layer.

**Param consistency check (Minor):** `listEventsSync` passes `singleEvents=true` and `maxResults=250` consistently for both baseline and delta calls. It correctly omits `orderBy`, `timeMin`, and `timeMax` (which are incompatible with `syncToken` per Google docs). No changes required here.

### Fix 2 — HTTP 410 Sync-Token Expiry (Important)

**File:** `packages/connectors/src/connectors/calendar-delta.ts`

Added `isSyncTokenExpired(err)` helper (mirrors Gmail's `isNotFound`) that checks `err.status === 410 || err.code === 410 || err.response?.status === 410` — matching the `ConnectorRequestError` shape from `base.ts` (which exposes `.status`).

On 410, the catch block drops the expired token, calls `accumulatePages(deps.listSync, undefined)` for a fresh baseline, emits NO events, and returns the new `newSyncToken`. This is self-healing — no human intervention required, mirrors Gmail's historyId recovery exactly.

### Fix 3 — Empty-Token Guard (Minor)

After the pagination loop and after the 410 recovery baseline, `newSyncToken === ''` falls back to `prior ?? ''`. Matches existing convention in the file (no new logger invented).

---

## Tests Added

**File:** `packages/connectors/test/calendar-delta.test.ts` (6 existing + 2 new = 8 total)

- **Pagination test:** mocks `listSync` to return page 1 (`items: [e1, e2]`, `nextPageToken: 'p2'`) then page 2 (`items: [e3]`, `nextSyncToken: 'tok2'`); asserts 3 events emitted and `newSyncToken === 'tok2'`. Also asserts correct `pageToken` threading between calls.
- **410 resync test:** mocks `listSync` to throw `{ status: 410 }` on the first call (prior token), then return baseline with `nextSyncToken: 'fresh'`; asserts `events: []` and `newSyncToken === 'fresh'`.

---

## Test Results

```
npx vitest run packages/connectors/test/calendar-delta.test.ts
  8 passed (8) — 266ms

npx vitest run apps/web/app/api/cron/connector-poll/route.test.ts
  11 passed (11) — 927ms
```

All 19 tests across both files pass. No pre-existing tests broken.
