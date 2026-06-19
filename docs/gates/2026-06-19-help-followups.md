# Adversarial Gate — Help center follow-ups (index, logo proxy, glyph)

**PR:** Help follow-ups (`feature/help-followups`) — follow-up to #172/#174.
**Date:** 2026-06-19
**Sensitive surfaces:** `supabase/migrations/` (new index) + `apps/web/app/api/` (logo proxy route) → full 4-reviewer gate.

## Scope
- `supabase/migrations/20260619250000_connections_account_status_index.sql` — composite index `connections(account_id, status)` (applied dev/staging/prod via MCP).
- `apps/web/app/api/connector-logo/route.ts` — same-origin proxy for connector brand logos (server fetches Clearbit; browser stays same-origin; allowlisted to catalog domains).
- `apps/web/components/help/ConnectorLogo.tsx` (+ test) — uses `/api/connector-logo` instead of `logo.clearbit.com`.
- `apps/web/components/shell/HelpButton.tsx` — help-circle SVG instead of bare "?".
- `apps/web/lib/help/content.ts` — `conn-clearbit-note` reworded to reflect the proxy.

## Verdicts
| Reviewer | Verdict |
|---|---|
| Claims-auditor | PASS (logo note accurate; no direct Clearbit ref left in client code) |
| Red-team | PASS (SSRF closed: exact-match allowlist before fetch + encodeURIComponent) |
| Cost-auditor | PASS (CDN caching offloads repeat loads; index well-motivated) |
| Logic-skeptic | PASS-WITH-FIXES (2 P2 — fixed below) |

## P2 findings — fixed in the route
1. **200-with-non-image cache poisoning.** `!upstream.ok` didn't catch a Clearbit HTTP-200 HTML rate-limit/maintenance page, which would be cached as a "logo" for the s-maxage week. **Fix:** require `content-type: image/*` before serving; otherwise 404 → client monogram fallback.
2. **`immutable` on a non-content-hashed URL.** Removed `immutable` from `cache-control` so a stale/bad entry stays refreshable; kept `max-age`/`s-maxage`.

## P3 findings — addressed / noted
- **Response size cap (red-team + cost):** added a 512 KB hard cap (`MAX_LOGO_BYTES`); oversized upstream → 404.
- **Intentionally-public route (red-team):** added an inline comment documenting why no auth is needed (public brand assets; `<img>` can't send auth).
- **Migration filename hour "25" (logic P3):** kept — consistent with the repo's existing sequence (`...240000` precedent); it's an ordering counter, sorts correctly, and the Supabase-applied migration name is independent of the filename.
- Provider-name in copy (claims P3): future-maintenance note only.

## Tests
Help/connector suites green (101 unit tests incl. ConnectorLogo `logoUrl` + encoding). 0 tsc errors in changed files.

## Final verdict
**PASS** (after fixes). No P1; both P2s resolved; P3 hardenings applied. Migration applied + verified on dev/staging/prod.
