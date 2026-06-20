# Gate — Pin the frontier budget day to UTC (close the tz-flip lever)

**Date:** 2026-06-20
**Branch:** `fix/budget-day-utc`
**Sensitive paths:** `packages/router/`, `packages/keeper/` → gate required.

## Verdict: PASS (controller review)

Closes the one concrete correctness nit shared by **#24** (budget sub-item) and **#52.1**: the per-user daily frontier (T2-from-chat) budget window was keyed to `dayKey(now, req.timezone)`, where `req.timezone` traced back to the user's **editable** `users.tz` profile field. A user could toggle tz around their local midnight to straddle two budget windows and mint a few extra T2 chat calls. Self-limited and transparent (P3), but a real lever.

### Fix
- **`packages/router/src/router.ts`** — the T2 budget day is now `dayKey(config.now())` (UTC), with a comment explaining why. The reset instant is fixed for everyone.
- **`packages/router/src/budget.ts`** — `dayKey` simplified to UTC-only (`toISOString().slice(0,10)`); the now-dead `timezone` param and the `Intl`/try-catch removed.
- **Dead plumbing removed** so the lever can't be re-wired: `RouteRequest.timezone` (types.ts), `KeeperChatContext.timezone` + the `route()` tz arg (keeper/chat.ts), and the `users.tz` fetch + tz arg in `apps/web/app/app/grove/actions.ts` (also drops one DB round-trip per chat turn). `req.timezone` and `dayKey()` had no other callers.

### Behavior change
The chat budget now resets at 00:00 UTC rather than the user's local midnight. For a soft per-day chat allowance this is immaterial to users and removes the abuse surface. Pipeline splurges (diagnosis synthesis, custom-spec drafting) are unaffected — they remain unbudgeted by design.

### Verification
- `vitest` packages/router + packages/keeper + grove: 172 passed. Updated two tests: "resets on the next UTC day" and "keys the budget day to UTC, never the user timezone (#24/#52)".
- lint clean on all touched files; tsc clean (the lone `@nibbin/keeper has no exported member DONE` is the known local junction stale-dist false-positive, resolved by CI's fresh `npm ci`).

### Risk
Minimal. No new surface; strictly removes a user-controlled input from a budget key and deletes the plumbing that carried it.
