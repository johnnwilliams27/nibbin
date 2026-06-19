# Adversarial Gate Report — Browser `computer_use` egress pinning

**Date:** 2026-06-19
**Branch:** `feat/browser-egress-pin` (off main incl. #163)
**Surface:** the SSRF egress boundary of the `computer_use` browser driver. Closes the two "before enabling `COMPUTER_USE_ENABLED`" residuals from `docs/gates/2026-06-19-browser-computeruse.md` (the P2 `route.continue()` rebind window + the missing live-Playwright test). Feature stays OFF by default. No migration.
**Reviewers:** red-team (SSRF/rebind lane) · logic-skeptic (correctness/non-regression). Right-sized to two lenses for a security-hardening change confined to `browser.ts` + tests.
**Verdict: PASS** — no P0/P1. A P1-latent (flag-off) class found by red-team + a P1 correctness bug found by logic-skeptic were BOTH fixed in-branch (`437efdc`); re-verified.

## What it is
Replaces Playwright's `route.continue()` (which lets Chromium open its own unpinned socket, re-resolving DNS → the rebind window) with **fetch-and-fulfill**: the `context.route('**')` interceptor fetches every request through the connector's pinned `safeFetch` (DNS resolved + every answer validated public + TCP connect pinned to the validated IP + per-hop redirect revalidation) and `route.fulfill()`s Chromium with those bytes. Chromium opens no unpinned socket for any HTTP request class — the rebind window is **structurally closed**, not narrowed. Credential headers (`cookie`/`authorization`/`proxy-authorization`) are stripped before forwarding; only benign headers pass. Fail-closed: every `EgressDeniedError`, size/timeout cut, or other throw → `route.abort()`.

## Findings — fixed in-branch (`437efdc`)
| Lens | Sev | Issue | Fix |
|------|-----|-------|-----|
| red-team | **P1 (latent, flag-off)** | **WebSockets + Service Workers bypass `context.route('**')` entirely** — Playwright's route API structurally cannot intercept WS handshakes or SW-originated fetches, so those would open unpinned Chromium sockets (the same rebind class). | `newContext({ serviceWorkers: 'block' })` blocks SW network; `context.routeWebSocket('**', ws => ws.close())` (guarded for ≥1.48) closes every WS without connecting upstream. The rebind window is now closed for ALL request classes, not just HTTP. |
| logic-skeptic | **P1 (correctness)** | **Verbatim response-header replay corrupts rendering.** `safeFetch` does NO decompression (`resp.body` = raw possibly-encoded bytes; `resp.headers` verbatim). Replaying `content-length`/`transfer-encoding` → `ERR_CONTENT_LENGTH_MISMATCH`/chunked mismatch → blank render. | `sanitizeResponseHeaders` denylist drops framing/hop-by-hop/`set-cookie` (`content-length, transfer-encoding, connection, keep-alive, te, trailer, upgrade, proxy-*, set-cookie`) so Playwright recomputes framing — but **KEEPS `content-encoding`** (the body is still encoded; dropping it would itself render garbage). |
| red-team | P2 | response `set-cookie` is harmless only because the request-side strip is comprehensive — fragile to a future edit. | Regression test: a request carrying `cookie`+`authorization` reaches `safeFetch` with NEITHER. SECURITY comment on `FORWARDABLE_HEADERS` tying the two. |
| logic-skeptic | P2 | `isRequestEgressAllowed` is now dead production code; its test battery mislabels coverage. | Deleted (zero production importers; the fetch-and-fulfill tests cover the real path). |
| red-team | P3 | `route.abort()` could reject unhandled on an already-handled route. | `safeAbort()` try/catch wrapper (mirrors `close()`). |
| red-team | P3 | non-egress schemes were all `continue()`'d. | Only `data:`/`blob:`/`about:` → `continue()`; `file:`/`ftp:`/`ws:`/unknown → `abort()`. |

### Verified correct (no finding)
- The rebind window is genuinely closed for every HTTP request class Playwright intercepts (main doc, internally-followed redirects, img/script/style/xhr/fetch/iframe/favicon/EventSource); the credential strip applies to every request; fail-closed is complete; the `fetchImpl` seam defaults to the real `safeFetch` and is test-only/unreachable from prod; no existing assertion was weakened; the live test is 3-way `skipIf`-gated (env flag + import + launch) so normal CI never runs or fails it; `playwright@1.61.0` has no postinstall, so CI install downloads no browsers.

### Carry-forward (non-blocking, in the design doc)
- **Provenance quirk (P3, accepted):** an HTTP redirect followed inside `safeFetch` leaves `page.url()` at the original URL, so the observation's source label reflects the original host — egress-safe (every hop validated+pinned), provenance-approximate. No code change.
- The live Playwright test must be RUN (with `COMPUTER_USE_LIVE_TEST=1` + `npx playwright install chromium`) as part of the eventual enablement op — it exists and is runnable; CI skips it.

## Verification (post-fix)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/planner` → **301 passed | 3 skipped** (live suite skips cleanly)
- `eslint …` clean · `npm run build -w @nibbin/web` → Compiled successfully

## Migration
None. Feature remains OFF by default (`COMPUTER_USE_ENABLED` + `playwright` absent in prod).
