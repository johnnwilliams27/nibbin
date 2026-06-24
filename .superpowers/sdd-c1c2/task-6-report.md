# Task 6 Report — `cron/collate-pass` route

## Status: DONE

## Files created / modified

| File | Action |
|------|--------|
| `apps/web/app/api/cron/collate-pass/route.ts` | Created |
| `apps/web/app/api/cron/collate-pass/route.test.ts` | Created |
| `apps/web/vercel.json` | Updated — added cron entry |

## Implementation notes

- **Auth**: same `isAuthorizedCronRequest` guard as all other cron routes → 401 when unset or wrong.
- **Account batch**: `svc.from('accounts').select('id').order('created_at', { ascending: false }).limit(200)` — simple bounded batch, most-recently-created first (no complex activity join needed per plan).
- **Fail-safe loop**: each `collateAccount` call is wrapped in `try/catch`; one account's error logs and continues. Counts from failed accounts are simply 0 (not counted).
- **Response shape**: `{ accounts, conflicts, deduped, stale, briefs }` as specified.
- **`console.error` pattern**: constant string first arg + separate value arg (no template-literal+arg mix) — semgrep-safe.
- **`vercel.json`**: entry added, daily at 06:00 UTC (`"0 6 * * *"`). This is the same file found at `apps/web/vercel.json`.

## Tests

7 tests, all passing:
1. 401 with no auth header
2. 401 with wrong secret
3. 401 when CRON_SECRET not set
4. With auth: queries accounts → calls `collateAccount` per account → aggregates counts correctly
5. One account throwing does NOT abort the rest — remaining accounts processed, response returns
6. Accounts query failure → `ok: false` returned (no throw)
7. Empty accounts list → `accounts: 0`, no `collateAccount` calls

## Typecheck

`npm run typecheck` — clean (no output).

## vercel.json

Found and updated at `apps/web/vercel.json`. Added:
```json
{ "path": "/api/cron/collate-pass", "schedule": "0 6 * * *" }
```
Daily at 06:00 UTC (same pattern as `account-purge` and `gmail-watch-renew`).
