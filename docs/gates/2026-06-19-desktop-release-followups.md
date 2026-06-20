# Adversarial Gate — Desktop release v0.2.2 follow-ups

**Date:** 2026-06-19
**Branch:** `feature/desktop-release-followups`
**Scope:** Desktop study `stopped`-emit on all terminal paths; admin 30-day LLM-spend aggregated via a Postgres RPC; freeform "build your own" fail-closed test coverage; desktop release prep (`tauri.conf` → 0.2.2 + release/checklist doc).
**Sensitive paths touched:** `supabase/migrations/`, `apps/desktop/src-tauri/` → gate mandatory.

## Verdict: PASS (after P3 fix)

| Reviewer | Result |
|---|---|
| Red-team (privilege/privacy) | Clean — no P1/P2 |
| Logic-skeptic | Clean — no P1/P2 |
| Claims-auditor | Clean — no P1/P2; all 5 claims verified vs live DBs |
| Cost-auditor | No P1/P2; 1 P3 (fixed) |

## Key checks
- **RPC privilege (red-team):** `admin_account_llm_spend_30d()` is `security definer` + `set search_path=''` with all objects schema-qualified; `execute` revoked from public/anon/authenticated, granted only to `service_role`; read-only aggregate; fenced behind the staff-gated admin page (`getStaff()` → redirect before the service-role client is built). No non-staff path to cross-account spend. Verified on all 3 DBs: `service_role`=true, `authenticated`=false.
- **Desktop `stopped` POST (red-team):** payload carries lifecycle metadata only (`studyId/kind/label/startedAt/endsAt`) — no capture content. Reuses the already-gated Bearer path; account derived server-side from `getUser()`, so the client can't target another account (`onConflict: account_id,study_id`).
- **Reporter logic (logic-skeptic):** dedupe Set keyed on UUID studyIds (no reuse); `POST_ACTIVE_STATES` is exactly the post-active set (ACTIVE/PAUSED never report); `startedAt` guard sits before the dedupe-`add`, so a delete-from-CONSENTED study (null `startedAt`) is correctly skipped and owes no signal (no `active` card was ever shown); poll is single `setInterval` behind a started-once guard that survives `boot()` re-entry.
- **Admin RPC semantics (logic-skeptic):** same arithmetic as the old JS sum; accounts with no calls absent → `spend_usd: null`, matching prior behavior.
- **Cost (cost-auditor):** 50s poll is local IPC; network POST fires once per study via the dedupe Set, not per tick; RPC is a strict data-transfer win (one row/account vs one row/call); no new LLM calls.

## P3 — FIXED
**Redundant duplicate index.** The migration created `model_calls_created_at_idx (created_at)`, a name-distinct duplicate of the existing `model_calls_created_idx (created_at)` (`IF NOT EXISTS` keys on name, so it created a real second index, taxing writes on a hot table). The existing `model_calls_account_idx (account_id, created_at)` already covers this GROUP-BY-account + range query. **Fix:** dropped `model_calls_created_at_idx` from dev/staging/prod and removed the `create index` from the migration; the RPC relies on the pre-existing indexes.

## P3 — accepted (cosmetic, no change)
- 30-day window cutoff now evaluated by Postgres `now()` vs the old client `Date.now()` — sub-second boundary difference only.
- `total_microusd` returned as numeric-string, coerced via `Number()` — exact for any realistic total.
- `stopped` is emitted even for the `DELETED` state — intended gap-closing behavior; metadata-only + idempotent.

## Migration
`20260619400000_admin_llm_spend_rpc.sql` applied + verified on dev/staging/prod; duplicate index removed from all 3.
