# Task 2 Report: SMS START Re-subscribe Handler

## Files Changed

- **Created**: `supabase/migrations/20260619100000_sms_opt_in_rpc.sql`
  - Mirrors `sms_opt_out` exactly: same audit_log columns `(account_id, actor, actor_id, action, subject, meta)`, same blank-guard, same grant/revoke style; inverts the mutation (sets `status='verified'`, clears `revoked_at`; `verified_at` untouched).
- **Modified**: `packages/channels/src/compliance/copy.ts`
  - Added `SMS_START_REPLY` export.
- **Modified**: `packages/channels/src/index.ts`
  - Added `SMS_START_REPLY` to the compliance/copy re-export line (alongside `SMS_STOP_REPLY`).
- **Modified**: `apps/web/lib/channels/sms-compliance.ts`
  - Added `optInSms(externalId)` mirroring `optOutSms` (service client, log-but-don't-rethrow).
- **Modified**: `apps/web/app/api/channels/sms/route.ts`
  - Extended imports to include `isStartKeyword`, `SMS_START_REPLY`, `optInSms`.
  - Wired START branch after HELP check, before normal-ingest fallthrough.
- **Modified**: `apps/web/app/api/channels/sms/route.test.ts`
  - Added `optInSms` to the `sms-compliance` mock.
  - Extended imports to include `SMS_START_REPLY` and `optInSms`.
  - Added `vi.mocked(optInSms).mockResolvedValue(undefined)` in `beforeEach`.
  - Added `describe('POST /api/channels/sms — START keyword (TCPA re-subscribe)')` block: 7 keyword variants + spaces test + "start the meeting" passthrough test (10 new tests).

## Test Commands + Output

```
npx vitest run apps/web/app/api/channels/sms/route.test.ts
→ Test Files  1 passed (1) | Tests  29 passed (29)

npx vitest run packages/channels
→ Test Files  14 passed (14) | Tests  41 passed (41)

npx eslint [changed files]
→ (no output — clean)

git grep "from '\..*\.js'" [changed files]
→ NO JS SPECIFIERS FOUND
```

## Self-review

- `sms_opt_in` audit_log column list exactly matches `sms_opt_out`: `(account_id, actor, actor_id, action, subject, meta)`. ✓
- `verified_at` is NOT touched; only `revoked_at` is cleared. ✓
- `isStartKeyword` was already exported from `@nibbin/channels` (confirmed in copy.ts + index.ts). ✓
- `SMS_START_REPLY` added alongside `SMS_STOP_REPLY` in the same export line. ✓
- No `.js` specifiers. ✓
- Migration NOT applied to any database. ✓

## Deviations / Concerns

None. Implementation matches spec verbatim.
