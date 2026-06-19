# Browser `computer_use` egress pinning — design (close the P2 rebind window + live test)

**Date:** 2026-06-19
**Status:** approved (closes the two "before enabling `COMPUTER_USE_ENABLED`" residuals in `docs/gates/2026-06-19-browser-computeruse.md`).
**Scope:** `apps/web/lib/planner/browser.ts` (+ a live test, + `playwright` devDep). Feature stays OFF by default. No migration.

## Problem (P2)
Today the `context.route('**')` interceptor validates each request URL via `isRequestEgressAllowed` and then calls `route.continue()`. `route.continue()` lets Chromium open its OWN socket, re-resolving DNS — so a sub-second-TTL DNS rebind between our validation and Chromium's connect can retarget the request to an internal host. The connector's `safeFetch` closes this by **pinning the TCP connect to a validated IP literal**, but Playwright's `Route` API never exposes that pin to us.

## Fix — fetch-and-fulfill (never let Chromium open a socket)
Replace `route.continue()` with: fetch the request ourselves through the pinned `safeFetch`, then `route.fulfill()` Chromium with those bytes. Because every request (main document, redirects, AND every subresource) is served from a connection `safeFetch` pinned + per-hop-revalidated, Chromium makes no unpinned socket connection at all — the rebind window is **structurally closed**, not merely narrowed.

### Interceptor algorithm (`context.route('**', handler)`)
For each intercepted request:
1. **Non-http(s) schemes** (`data:`, `blob:`, `about:`) — no network egress, no SSRF vector → `route.continue()` (or fulfill empty for unsupported). These never reach a socket to a host.
2. **http(s)** — call `safeFetch(url, { method, headers, body }, policy, httpOpt)`:
   - `method` = `route.request().method()`; `body` = `route.request().postData()` if present (a read tool is GET-dominant; click/type are drafted, not committed, so writes only flow on approved `commit()`).
   - **Strip credential headers** (`cookie`, `authorization`, `proxy-authorization`) before forwarding — a fresh context has no cookies; never forward ambient credentials to arbitrary hosts. Forward only benign headers (`user-agent`, `accept`, `accept-language`, `content-type` for POST).
   - `policy`: `{ maxResponseBytes: EGRESS_MAX_BYTES (generous, e.g. 5 MB default), timeoutMs: NAV_TIMEOUT_MS, maxRedirects: 3 }` — generic-rail (no `allowedHosts`) so any *public* host is reachable but private answers are rejected.
   - `httpOpt`: pass `allowHttp` when the request URL is `http:` (parity with today's navigate probe).
   - On success → `route.fulfill({ status: resp.status, headers: resp.headers, body: resp.body })`.
3. **Fail closed.** Any `EgressDeniedError` (private-ip / dns / allowlist / protocol / redirect / port / credentials) OR any other throw OR a `size`/`timeout` cut → `route.abort()`. (For the fulfill path a `size`/`timeout` means we could not retrieve the full body over the pinned connection, so we cannot serve it safely → abort. This differs from the *navigate pre-probe*, where `size`/`timeout` prove a public host was reached and are allowed to fall through.)

### `navigate(url)`
- Keep the existing fail-fast `safeFetch` pre-probe (1-byte, fail-closed on non size/timeout `EgressDeniedError`) for a clean early error before launching Chromium.
- Keep `page.goto(url, { waitUntil: 'domcontentloaded' })` — the main-document request now flows through the fetch-and-fulfill interceptor (pinned), so `page.url()` becomes `url` with content served from pinned bytes.
- Keep `guardCurrentUrl(page)` after goto and in every read verb (defense in depth — a meta-refresh / history.pushState to an internal URL is still re-asserted).

### Unchanged invariants
- `assertSafeNavigateUrl` (runtime, literal-IP + internal-suffix filter) and the planner's navigate guard stay.
- Ceilings (`COMPUTER_USE_CEILINGS`), the 10× weight, read-quarantine, write-drafting/approval-commit, `close()` lifecycle — untouched.
- Feature OFF by default (`COMPUTER_USE_ENABLED` + dynamic `playwright` load); Mock driver for tests.

## P3 — live Playwright integration test
Add `playwright` as a **devDependency** (verify the worktree's real `npm install` does NOT break the gated build — set/respect `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` so install doesn't fetch ~200 MB of browsers in CI). Add an integration test (e.g. `apps/web/lib/planner/browser.live.test.ts`) that:
- **`skipIf`** the real `playwright` import fails OR a Chromium launch fails OR `COMPUTER_USE_LIVE_TEST !== '1'` — so normal CI (no browser binary) is never broken; a human runs `npx playwright install chromium && COMPUTER_USE_LIVE_TEST=1 vitest run …` pre-enablement.
- When enabled: drive the REAL `PlaywrightBrowserDriver` against real Chromium and assert (a) the `context.route('**')` handler actually fires on a navigation; (b) a navigation whose host resolves to a private/localhost address is **aborted** (served nothing / blocked observation) — use the `safeFetch`/`isRequestEgressAllowed` test seam or a loopback server to simulate; (c) a public navigation is fulfilled from pinned bytes and the observation is quarantined.

## Verification
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/planner` → green (existing 252 computer_use tests + new interceptor unit tests); the live test SKIPS cleanly
- `eslint …` clean · `npm run build -w @nibbin/web` → Compiled successfully
- Confirm `npm install` with `playwright` added still yields a green build (no postinstall breakage).

## Out of scope
Subresource fidelity beyond text extraction (streaming, websockets) — acceptable for a bounded supervised read/draft tool. Enabling the flag in prod (separate op once this + a live run land).
