# Adversarial gate — OAuth token refresh-on-401 (2026-06-17)

- **Branch / PR:** `feature/token-refresh` → `main`
- **Reviewed diff:** `packages/connectors/src/connectors/base.ts`, `packages/connectors/src/oauth/client-credentials.ts` (new), `packages/connectors/test/base-refresh.test.ts` (new)
- **Gate run by:** Claude on 2026-06-17 (focused review — small, single-purpose change)

## Context
Found while activating Gmail push: `refreshAccessToken` existed but had **zero callers**; `base.ts` threw on every 401 ("refresh-on-401 is the caller's concern at M4" — never built). So every connection's access token died ~hourly, breaking watch/poll/sweep. This wires the deferred refresh.

## CI step
- typecheck: ☑  tests (903): ☑  lint: ☑  audit: ☑  SAST: ☑  redaction corpus: ☑

## Adversarial reviewers
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | reviewed | 0 | 0 | 0 | 0 |
| claims-auditor | reviewed | 0 | 0 | 0 | 0 |
| logic-skeptic | reviewed | 0 | 0 | 0 | 0 |
| cost-auditor | reviewed | 0 | 0 | 0 | 0 |

## Findings
None (P0/P1/P2/P3). Review notes:
- **Security:** the refreshed token is re-sealed in the vault only (C9) — never logged. Client creds come from server-side env (`GOOGLE_OAUTH_*`). `refreshAccessToken` egresses via `safeFetch` pinned to the connector's allowlist (`oauth2.googleapis.com` is allowlisted) — no SSRF. On refresh failure (revoked/absent refresh token) it surfaces the typed `auth` error rather than silently retrying — fail-safe (user reconnects).
- **Correctness:** single retry via an `isRetry` guard — no infinite loop; a post-refresh 401 throws. The retry re-reads the vault, so it uses the freshly-sealed token. `tryRefresh` returns a boolean (never throws) so the caller cleanly falls through to the typed error. Covered by tests: refresh+retry success, no-refresh-token → auth error, refresh-failure → auth error.
- **Cost:** at most one extra (401) request per token lifetime (~hourly) per connection — bounded, no runaway.
- **Claims:** no new data access; refresh re-uses the existing granted scopes.

## Disposition
- Blocking (P0/P1) resolved: ☑ (none)
- **Gate verdict:** PASS
- **Signed:** _pending John_
