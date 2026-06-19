# Adversarial Gate — Reach-Me Go-Live

**Branch:** `feature/reach-me-golive` (range `aa92add..b05cbbb`, 7 commits + test fix `3e6854a`)
**Date:** 2026-06-19
**Plan:** `docs/superpowers/plans/2026-06-19-reach-me-golive.md`
**Surface sensitivity:** HIGH — §11 spend/COGS caps, TCPA opt-out reversal, an internal auth route, five service-role / security-definer RPCs, anomaly detection. Adversarial gate is mandatory per AGREEMENTS.

## Scope reviewed
Five tasks: (1) Telegram `setWebhook` helper + internal registration route + runbook; (2) SMS START re-subscribe (`sms_opt_in`); (3) spend-cap window alignment to UTC calendar-day + one-time ~80% soft-warn; (4) adaptive-baseline anomaly check (replaces fixed 30/hr cap) with breather + audit flag (no auto-pause); (5) drip quiet-hours unified onto `notification_settings`, `drip_arcs.quiet_*` retired.

## Mechanical gates
- `eslint .` — clean.
- Full `vitest run` — **1303 passed, 3 skipped, 0 failed** (incl. new RLS suites: channel-budgets 11/11, channel-anomaly-baseline 8/8, reach-me-channels 6/6, drip 29/29).
- `next build` (@nibbin/web) — success.
- `.js` relative-import specifier scan on 27 changed files — none.

## Adversarial reviewers (4 lenses)

| Lens | Model | Verdict | Notes |
|---|---|---|---|
| Red-team (security/auth/RLS) | opus | **PASS** | Internal route fails closed on empty secret + constant-time compare; no bot-token leak; webhook URL env-derived (no Host-injection). All 5 RPCs service-role-only or member-gated; `search_path=''` + fully-qualified throughout. `sms_opt_in` only restores `revoked` rows (no `pending` escalation), behind the Twilio signature. Drop/recreate runs in one transaction — no orphan-grant window. Anomaly fail-open backstopped by fail-closed `take()`; audit `meta` via `jsonb_build_object` (no injection). |
| Cost-auditor (§11 COGS) | opus | **PASS** | Calendar-day spend window counts the same `cost_microusd`/channel predicate as the old rolling fn — no undercount, SMS 200k sub-cap intact. Gate meters prior spend then hard-blocks **before** increment; soft-warn fires only on the granted path and never suppresses the block. No model call outside the gate / before `take()`. UTC daily reset is the intended cap window, not an exploit. |
| Claims-auditor (contract/claims) | sonnet | **PASS** | Every RPC param name matches its SQL signature (the prior `p_account` vs `p_account_id` class of bug checked). No stale 4-arg `set_notification_prefs` caller. No surviving `drip_arcs.quiet_*` reference. Exports wired; tests assert real behavior. |
| Logic-skeptic (edge cases/races) | sonnet | **PASS** | Soft-warn dedup exactly-once via PK + `GET DIAGNOSTICS` (concurrent turns serialize, only one warns; never on a denied turn). Baseline window `[today-7d, today)` vs today `[today,∞)` — disjoint; float `/7.0`; floor protects zero-baseline accounts; strict `>`. Quiet-hours `coalesce(.,21/9)` defaults preserved; `digest_mode` `coalesce(param, existing)` preserves on omission. Warn delivered after main reply, never double-sent. Zero-row RPC → `take` fails closed, `anomaly` fails open (both correct). |

**Result: PASS (4/4, zero P1/P2).**

## Findings (advisory, non-blocking)
- **P3 — `channel_spend_notice` has no explicit `grant ... to service_role`.** Not a defect: the security-definer `channel_turn_take` runs as the function owner, and the sibling `account_spend` table (live in prod) uses the identical `revoke all from anon/authenticated` pattern with no service_role grant and works. RLS tests confirm the insert works (11/11). No action — kept consistent with the established precedent.
- **P3 — soft-warn DB test relies on `now()` defaulting to today.** Sound (DB clock), theoretically fragile only across the exact UTC-midnight instant. Test-only.
- **P2 (pre-existing pattern) — `saveNotificationSettings` swallows the email-toggle mirror error.** Intentional per the original design comment (a pre-arc account has no `drip_arcs` row); the unified `notification_settings` row is the source of truth. Carried over unchanged.

## Note on process
A fix-agent on Task 3 misdiagnosed a real RLS regression (the hard-block spend-cap test) as "pre-existing." The controller verified independently, found the calendar-day window had broken the test's date assumption, and fixed it by pinning the seeded `created_at` to the test's `DAY` (commit `3e6854a`). Production was never affected (TS passes `todayUtc()`).

**Human sign-off:** pending (per AGREEMENTS, a human adversarial-gate sign-off is recorded before/at merge).
