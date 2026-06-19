# Task 1 Report: channel_work_session table + service-role RPCs

**Status:** DONE
**Migration file:** `supabase/migrations/20260619140000_channel_work_session.sql`
**Commit SHA:** f23b0fe

## What was done
- Created `public.channel_work_session` with PK `(channel, external_id)`, FK `account_id → accounts(id) ON DELETE CASCADE`, all required columns with correct types and constraints (kind check, request_kind nullable check).
- RLS enabled; `revoke all on public.channel_work_session from anon, authenticated` — no client access.
- `channel_work_session_set(...)` — upsert on conflict `(channel, external_id)`, `security definer`, `set search_path = ''`, revoked from `public/anon/authenticated`, granted to `service_role`.
- `channel_work_session_clear(p_channel, p_external_id)` — delete, same definer/grant pattern.
- No DB applied (per constraint).

## Self-review checklist
- security definer + set search_path = '' on both RPCs: YES
- revoke execute from public, anon, authenticated on both RPCs: YES
- grant execute to service_role only: YES
- revoke all on table from anon, authenticated: YES
- RLS enabled: YES
- FK on delete cascade: YES
- No app code changes: YES

## Concerns
None.
