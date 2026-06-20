# Adversarial Gate — Thin-Shell Observer (cutover)

**Date:** 2026-06-20
**Branch:** `feature/thin-shell-observer`
**Scope:** Desktop UI becomes 100% the embedded nibbin.com web app. New Field Study web routes (`/app/study` + review/notes/preferences + start wizard), web bridge wrapper + `isShell`, native query handlers, **the remote-origin IPC capability expanded to write/destructive commands**, grove-home card swap, and the cutover (grove webview full-window; native Field Study UI deleted, ~1500 lines).
**Sensitive paths:** `apps/desktop/src-tauri/`, the bridge capability, `apps/web/app/api`-adjacent. Gate mandatory.

## Verdict: PASS (after fixes)

| Reviewer (model) | Result |
|---|---|
| Red-team (opus) — capability/privacy crux | No P1/P2; 3 P3 + 2 accepted risks |
| Logic-skeptic (opus) | 1 P1, 1 P2, 1 P3 — all fixed |
| Claims-auditor (sonnet) | 1 P2, 1 P3 — fixed |
| Cost-auditor (sonnet) | No P1/P2; 2 P3 (1 fixed, 1 deferred) |

## Security crux — the write-command expansion (red-team)
The capability now grants the embedded nibbin.com webview write/destructive commands (`send_control` incl. `delete_everything`/`stop_early`/`pause`, `create_study`, `review_delete`, `access_token`). **Contained correctly:** Tauri 2.11 resolves IPC against the *invoking frame's* origin vs `remote.urls` at invoke time — so subframes (`evil.com` iframe), popups (different webview label), and redirects cannot inherit the bridge; the `main` webview gets only `core:event`; `on_navigation` is top-level defense-in-depth. C6 global pause hotkey survives natively (works even if the web layer breaks). Every deleted native privacy control has a web replacement. No new egress (bridge returns only redacted/derived data; packet upload unchanged); daemon stays the C2–C5 enforcer.

## Fixed before merge
- **P1 (logic)** — offline Retry was dead (`grove_show` early-returned without reloading). Added `grove_reload` command (`Webview::reload()`, Tauri 2.11.2) wired to the offline Retry button.
- **P2 (logic)** — an active study could flash (and on a daemon blip persistently show) the StudyStart wizard. Added a `loaded` guard (no wizard before the first `studyStatus()` resolves) and a dedicated "Reconnecting…" state for `DAEMON_OFFLINE` — `isIdle` now true only for genuine NOT_STARTED/terminal states.
- **P2 (claims)** — remove-exclusion copy said "takes effect on restart" but the daemon doesn't implement RemoveExclusion at all. Now the remove control is disabled with an honest "not available yet" note.
- **P3s (folded in)** — silent no-op start guard (only `onStarted()` when status actually advanced); async-cleanup race in `onStudyStateChange` (cancelled-flag) in both study page + DesktopOrStudyCard; `on_navigation` now requires `https` scheme (handoff-token downgrade defense); CSP `frame-ancestors 'self'` + `X-Frame-Options` headers; corrected two misleading comments (StudyStart "verbatim", capability NIBBIN_GROVE_HANDOFF).

## Accepted risks (documented, NOT fixed — inherent to the trusted-first-party-origin model)
- **`access_token` over the bridge** widens XSS blast radius: an XSS on nibbin.com could lift the native keychain JWT. Bounded by JWT lifetime + sign-out-everywhere revocation. Accepted; revisit by gating `access_token` to only the packet-upload path if the threat model tightens.
- **`delete_everything` callable by the embedded page** → an XSS'd nibbin.com could purge local capture (destructive, not exfiltrating). Consistent with C3 (user retains delete control). Accepted.

## Deferred (non-blocking)
- Review list has no virtualization — only matters at >500 events; revisit if p99 event counts grow.

## Claims verified
The six consent privacy bullets are **verbatim** from the deleted native `consent.ts` (character-for-character; "What gets captured" = Lite variant, "When it ends" differs correctly by kind). All four routes call real bridge methods; every web-invoked command has a matching capability grant. Notes EmptyState + (now) remove-exclusion copy are honest about daemon stubs.

## Verification
`npm run lint` clean (one pre-existing gitignored `target/` build-artifact error, absent in CI); `tsc` zero errors in changed files; `npx vitest run apps/desktop` 31/31. Full cargo + next build validated by CI (the "Desktop app crate (cargo check)" job + the gates job). On-device verification of the live shell behavior is the final step at release.
