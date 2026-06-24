# Adversarial gate — Reach me on the go (2026-06-24)

- **Branch / PR:** `feat/reach-me-on-the-go` → `main` (#TBD)
- **Reviewed diff:** `git diff origin/main...HEAD` at `0ceeae9d` (rebased onto fresh origin/main `72132e02`)
- **Gate run by:** Claude (Opus 4.8), four reviewer sub-agents, on 2026-06-24

> Note: the sensitive-paths CI step (`adversarial-gate.yml`) does **not** trip on this
> diff — it matches `supabase/migrations/`, `packages/{runtime,connectors,keeper,router}/`,
> `apps/web/app/api/`, `apps/desktop/src-tauri/`, and this PR touches none of those
> (only `apps/web/app/app/**` + `apps/web/lib/privacy/**`). The report is committed
> anyway because the feature surfaces channel-connection UX, per the build directive.

## Feature summary
A presentational "Reach me on the go" modal surfaced from a paper-plane button in the
Keeper panel header and the focal header (both gated to step === 'done'). It REUSES the
existing Data & Privacy server actions verbatim (`connectChannel` / `disconnectChannel` /
`saveChannelPrefs`) and the `channelMeta()` helper. A new read-only loader
(`loadReachMeData`) runs the same RLS-scoped queries the privacy page already runs
(`notification_channels`, `channel_prefs`). **No new backend, no migration, no new server
action, no new RPC, no new query shape.** The entire authZ trust basis is inherited from
the `/app/settings/privacy` surface.

## CI step
- typecheck: ☑ (clean after `rm -rf apps/web/.next apps/admin/.next`)
- tests: ☑ new suite 14/14; full suite — only `tests/rls/*` (need local Postgres) and
  `packages/connectors/test/rails.test.ts` (IMAP socket) fail, both sandbox/network-bound
  and pre-existing, unrelated to this diff
- lint: ☑  build: ☑ (web + admin)
- audit/SAST/redaction-corpus/trigger-graph: n/a (no sensitive surface in diff)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 2 |
| claims-auditor | PASS | 0 | 0 | 0 | 0 |
| logic-skeptic | REQUEST CHANGES | 0 | 1 (H1) | 1 (M2) | 0 |
| cost-auditor | PASS | 0 | 0 | 0 | 1 |

## Findings (severity-ranked)

- **H1 (logic-skeptic) — actions redirect away from the grove.** `disconnectChannel` and
  `saveChannelPrefs` end in `redirect('/app/settings/privacy?...')`, so toggling "Reach me
  here", disconnecting, or connecting a non-live channel navigates the user to the Data &
  Privacy page (the Telegram-connect happy path escapes via the `t.me` redirect first).
  **Disposition: ACCEPTED BY DESIGN, not a defect.** The build directive mandates reusing
  these actions verbatim and explicitly forbids adding a new server action. A return-path
  variant would be a new action. The landing page shows the matching success/error
  `InlineFeedback` ("Saved" / "Disconnected"), so it's a route change, not a broken state.
  In-code doc comment in `ReachMeModal.tsx` broadened to state this precisely (was
  understated as only an "error / non-Telegram-live edge").

- **M2 (logic-skeptic) — panel button gates on static `initialStep`, not live `step`.**
  Correct in practice: the dock hosting `KeeperPanel` (`KeeperDock` via `app/layout.tsx`)
  is only mounted when `grove.step === 'done'`, so `initialStep` is always 'done' there and
  the panel never hosts a live onboarding-completing session (that happens in the focal
  `OnboardingCanvas`, where `KeeperChat` gates on its live `step`). **Disposition: comment
  tightened** in `KeeperPanel.tsx` to state the actual invariant; no behavior change needed.

- **P3 (cost-auditor) — focus-listener `router.refresh()` could thrash on an idle modal.**
  `router.refresh()` re-runs the full route tree (incl. `page.tsx`'s `resumeQueuedRuns`
  pass) on every window-focus. **Disposition: FIXED.** The focus listener is now gated to
  fire only while a *live* channel is still unverified (`channels.some(c => c.live &&
  c.status !== 'verified')`); the on-mount refresh was removed (props are fresh at open).
  An already-connected/idle modal no longer refreshes on alt-tab.

- **P3 (red-team) — `disconnectChannel` hidden input `c.channelId ?? ''` fallback.**
  Unreachable (only renders in the connected branch where `channelId` is a real UUID); if
  it ever fired, `revoke_channel('', ...)` raises invalid-uuid caught by the action's error
  redirect. **Disposition: KEPT** — the `?? ''` is the safer TypeScript pattern (avoids a
  non-null assertion) and has no security impact.

- **P3 (red-team) — loader not marked `'server-only'`.** No leak today: all client
  components import `import type` only (erased at build); `TELEGRAM_BOT_TOKEN` is read only
  as a `!!` boolean for the `live` flag and never serialized. **Disposition: ACCEPTED
  non-blocking** — adding `import 'server-only'` is optional defense-in-depth; skipped to
  avoid any risk to the green build over a confirmed non-finding.

### Held attack surfaces (red-team, all HELD)
IDOR via forged `channel_id`/`channel` (server-derived `target_account` + `is_account_member`
+ account-scoped UPDATE → 0 rows); RLS cross-account read (member-scoped SELECT policies,
direct mutation revoked from `authenticated`); priority/urgency tampering (double-clamped in
`parseChannelPrefsForm` + RPC); stored-XSS via `external_label` (fetched but never rendered;
no `dangerouslySetInnerHTML`); CSRF (native Next Server Action protection); secret bundle
leakage (boolean-only read + type-only client imports); refresh/auto-submit abuse (idempotent,
account-scoped, no side effects).

## Disposition
- Blocking (P0/P1) resolved: ☑ (H1 is spec-accepted-by-design, not a defect; documented)
- Non-blocking tracked: ☑ (M2 comment fixed; cost P3 fixed; two red-team P3 nits dispositioned)
- **Gate verdict:** PASS
- **Signed:** pending John's review
