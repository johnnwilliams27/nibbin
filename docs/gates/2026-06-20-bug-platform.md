# Gate — Bug cleanup: platform/infra (#30, #28, #27, #24)

**Date:** 2026-06-20
**Branch:** `fix/bug-platform`
**Sensitive paths:** `packages/connectors/`, `apps/desktop/src-tauri/`, Sentry configs, `supabase/migrations/` → gate required.

## Verdict: PASS (controller review) — with two items deferred (see below)

118/118 tests pass; lint clean; no tsc errors in changed files.

### #30 — 4 of 5 sub-fixes shipped; #30.3 DEFERRED
- **#30.1 (egress, security):** `safe-fetch` strips body + content-type on 307/308 redirects (a safe superset of the cross-host requirement — our connector egress is GET-dominant, so over-stripping a redirect body is fail-safe and prevents payload leakage to an unintended host).
- **#30.2:** removed the dead/unimplemented `generateNonce()` (honest — no half-built nonce).
- **#30.4:** study-machine clock compare now via `Date.parse()` epoch-ms (no lexicographic ISO bug).
- **#30.5:** send-velocity window uses `max(oldest+24h, created_at+cooldown)` so new accounts aren't overstated.
- **#30.3 DEFERRED (regression-avoidance):** making the refresh_token native-only (out of the webview) would kill the embedded session after ~1h with no auto-refresh, since the webview can no longer refresh. Reverted (commit 119ede1d). The security gain is marginal — refresh-token exfil on the *trusted* nibbin.com origin is the same accepted-risk class as the thin-shell `access_token` finding we already accepted. #30 stays open for #30.3 pending a native token re-injection trigger.

### #28 — DONE
Two-phase webhook idempotency: `markProcessed()`/`isProcessed()` distinct from `recordOnce` (seen vs processed); migration `20260620160000_webhook_events_processed_at.sql` (renumbered from a colliding 140000) adds `processed_at`, applied dev/staging/prod. A seen-but-unprocessed event is retryable on redelivery; a processed one is a true duplicate. Retry test added.

### #27 — DONE
Shared `sentryBeforeSend` scrubber (`@nibbin/shared/sentry-scrub`) wired into all four Sentry configs (web + admin, server + edge): strips `code/state/token/access_token/refresh_token` query params, drops auth headers, redacts token-shaped strings.

### #24 — PARTIAL
`recordModelCall` now early-returns when `modelContributionEnabled === false`, so the contribution path honors the opt-out at the recording seam; the DB view gate (`20260619320000`) remains defense-in-depth. Remaining: each caller must fetch+pass the account flag for per-row honoring everywhere — tracked on #24, not fully closed.

## Notes
No raw-data egress introduced; the Sentry scrubber + redirect-body strip are net privacy/security positives. Migrations are additive + idempotent.
