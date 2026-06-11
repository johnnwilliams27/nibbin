# STATE

- Milestone: M2+M3+M6 — COMBINED GATE RUN 2026-06-11 on integrated main (`ba047cf`), awaiting
  John's signature in LEARNINGS.md. **No P0. No live-exploitable P1.** Five P1-labeled findings are
  forward-coupling conditions on unbuilt surfaces (issues #22–#24, #26, #29); one live P2 honesty
  bug in scripted chat (#25); P2/P3 sweep in #27, #28, #30. Full CI green locally + on main HEAD
  (run 27327110748, all 5 jobs). DoD caveats for John: M3 "12+ connectors live in staging" is
  code-complete but still not deployment-verified; M6 "budgets met" + the <100ms pause latency
  await the on-hardware macOS bring-up pass.
- Merged this sprint: M3 (PR #14, `b03553b`), Sentry observability (PR #16, `f64e9fc`; env-live
  docs PR #19), M2 (PR #17, `b27b363`), M6 (PR #18, `b5dc06b`).
- Milestone: M1 — GATE RUN 2026-06-10, CLEAN of P0/P1, signed. Remaining M1 work is external-only:
  enable Google/Apple auth providers + FILE the Google OAuth/CASA + Meta IG-DM approvals (needs
  John's Google Cloud + Meta accounts).
- M0: COMPLETE, gate signed by John W. 2026-06-10 (LEARNINGS.md).
- Next build milestone: **M4** (scan engine, Agent Shop, runtime with School gates). Hard
  conditions wired to M4-adjacent PRs: durable BudgetStore + C11 training opt-in land in the same
  PR as the first real `generate` (#24); structural write-grant rows + atomic velocity store before
  Instagram/QuickBooks go live (#26); webhook "seen ≠ processed" fix before handlers wire (#28);
  Sentry beforeSend scrubber before connector callbacks ride those configs (#27).

## M2 — merged (PR #17, CI-green, adversarially reviewed at PR time + gate)
- Grovekeeper visual chat (apps/web/app/app/grove): layered SVG grove scene, dawn/day/dusk,
  canonical engine Keeper, onboarding §4.1 steps 1–3 playable end-to-end, reduced-motion parity.
  Server-authoritative state machine; persistence via membership-checked `save_grove_state` RPC
  (forward-only steps, Keeper name immutable); RLS attack suite in tests/rls/grove-state.test.ts.
- packages/router: T0/T1/T2 router per §6.3 — deterministic zero-token classifier, per-user
  per-local-day frontier budget with transparent degradation, hot-reloadable models. Interface
  published for M4. KNOWN: in-memory budget store is not a real cap on serverless (#24); scripted
  chat burns budget + shows the degradation notice with no model wired (#25).
- packages/keeper: conversation core, pure by construction (C10 — exports no tools, performs no IO).
  Chat replies come from the zero-cost scripted T0 floor; **no real `generate` is wired** — LLM
  COGS today is $0.
- Migration 20260610230000_m2_grove_state applied (see Platforms below).

## M3 — merged (PR #14) + now formally gated
- Connector platform (packages/connectors + migration 20260611000000): registry (20 tier-1 entries,
  runtime-validated), OAuth engine (PKCE+state, read-only-by-default per C8, per-Nibbin write
  upgrades), Supabase Vault token storage per C9 (token_ref uuid only; service-role-execute RPCs;
  revoke destroys secret + cascades in one txn), webhook verification (HMAC/Stripe/Meta/Slack/
  Google channel-token/Pub-Sub OIDC) + replay windows + DB idempotency, deny-by-default egress
  proxy (public-IP-only, DNS-pinned connect, redirect credential-stripping) per §6.9, quarantine
  markers, send-velocity caps. Six hand-built [H] clients, aggregator adapter [A], generic rails
  [G]. Gate re-attack: SSRF/vault/RLS all held; C8 caveat for QuickBooks/Instagram tracked in #26.
- Google connectors gated behind the 100-user tester allowlist + cap pending OAuth verification/
  CASA; Instagram behind Meta app review (enforced in the OAuth engine).
- "12+ connectors live in staging" remains deployment-unverified (code-complete; no staging deploy
  exercise yet) — carried as a DoD caveat on the gate report.

## M6 — merged (PR #18, CI-green incl. desktop-rust job, adversarially reviewed at PR time + gate)
- Observer (apps/desktop, Tauri 2.x; macOS first, Windows behind the same capture trait):
  capture trait + 4-layer fail-closed redaction (packages/redaction, rules shared TS/Rust via
  include_str!) + SQLCipher store with OS-keystore key wrap + independent deletion verifier (C3) +
  study state machine with daemon-enforced day-14 stop + monotonic anti-rollback (C2) + review UI +
  local Field Notes + nibbin://auth PKCE deep-link sign-in.
- Claims status at gate: C1/C2/C3/C5/C7/C9/C10 enforced by construction; C4 structural at the type
  layer, OS-flag mapping TODO (#23); C6 structural but the daemon control loop bounds pause latency
  at ~250ms vs the published <100ms (#22). Capture adapters fail loud until on-hardware bring-up;
  nothing can capture or upload today.
- vendor/screenpipe frozen at last MIT commit `892199f742` (upstream relicensed commercial
  2026-06-10; see vendor/screenpipe/VENDOR.md). Never pull upstream HEAD. SPEC §9's "Fork
  Screenpipe (MIT)" row flagged for revisit.

## Observability
- Sentry LIVE (PR #16 + #19): org `nibbin`, projects nibbin-web + nibbin-admin; five env vars on
  the Vercel project; both DSNs verified ingesting; source-map upload via org token. Client configs
  hardened (replay masked, sendDefaultPii false; admin replay disabled). Server/edge configs lack
  the RISKS §3 beforeSend scrubber — #27, fix before M4.

## Platforms / environments
- Supabase: org `Nibbin` (paid), us-east-2, PG17. Projects: dev `oqnqzytctwlptfdvyagl`, staging
  `swbbydpuiilnamnyhwnr`, prod `oaymttudfazqaqequrke`. ALL migrations (170000/190000/210000/220000/
  240000/20260610230000/20260611000000) applied + verified on all three. Secrets in GitHub env
  secrets + Vercel production. Auth redirect allow-lists exact (no wildcards).
- Vercel: project `nibbin` (team `nibbin`). Production env complete (prod Supabase keys + test
  Stripe + site URL + Sentry); prod live.
- Stripe (TEST mode): products/prices created (Grove $19/mo, Canopy $49/mo, top-up $5); webhook
  endpoint at nibbin.com/api/stripe/webhook.
- Branch protection on `main`: ENABLED — 4 required strict checks, PRs required, enforce_admins,
  linear history, no force-push/delete.
- Production URLs: https://nibbin.com (apex/www/app) + https://nibbin.vercel.app — live over HTTPS.
- Repo: github.com/johnnwilliams27/nibbin (private), default branch `main`.

## M1 approval tracking (DoD = "both processes initiated and tracked here")
- Google OAuth verification/CASA: NOT YET FILED — needs Google Cloud project. Draft:
  docs/submissions/google-oauth-verification.md. Record submission + CASA dates here when filed.
- Meta App Review (IG DMs) + Business Verification: NOT YET FILED — needs Meta account. Draft:
  docs/submissions/meta-app-review.md. Record submission + business-verification dates here when filed.

## Open P0/P1: none live
Forward-coupling P1 conditions tracked: #22 (C6 latency at bring-up), #23 (C4 OS flags with
capture bring-up), #24 (C11 opt-in + durable budget with first real `generate`), #26 (C8
structural grants before IG/QB live), #29 (retention enforcement before claims pages route).

## Outstanding for John
- SIGN the M2+M3+M6 gate in LEARNINGS.md (report delivered 2026-06-11) — includes accepting the
  forward-coupling-condition triage or overruling it.
- ROTATE the Supabase access token + the Vercel token (both shared in chat; all uses complete).
- Swap Stripe to LIVE keys before real launch (prod runs test-mode Stripe now).
- Provide Google Cloud + Meta developer accounts → enable Google/Apple auth providers + file the
  two approvals (the only remaining M1 items).
- Free-tier (Hatchling) monthly credit refresh is a later scheduled job (deferred; new accounts
  start at 0 credits until a grant/subscription).
