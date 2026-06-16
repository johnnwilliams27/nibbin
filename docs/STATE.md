# STATE

- Milestone: **M6.5 — Model Bring-Up — SIGNED + MERGED 2026-06-12** (PR #51 → main `4d5529c`). The
  first real model calls ship: Anthropic-direct behind the §6.3 router (T1 Haiku 4.5, T2 Sonnet 4.6,
  Opus pinned to diagnosis), durable frontier budget (#24 CLOSED), keeper chat + agent drafts +
  scan/diagnosis on real models, eval suite (`npm run evals`) as the model/prompt-change gate,
  model_calls COGS ledger + admin card, top-up repriced $5→$10/1,000 (founder-approved on measured
  numbers). No live P0/P1 (1 P1 + 2 P2 fixed in-gate `fa31bfb`); 1 claims P1 (C11 opt-in write-only)
  tracked on #29 as M7-entry; P3s + M7 diagnosis-pricing watch in #52. Margins 90–95% every SKU.
  **Rollout done 2026-06-12:** migration 20260612120000 applied + hash-verified identical on
  dev/staging/prod (digest `a74c9fc4…`; dev's `frontier_budget_take` was re-synced from a pre-fix
  iteration). `ANTHROPIC_API_KEY` set in GitHub dev/staging/prod env secrets + Vercel `nibbin`
  Production; `STRIPE_PRICE_TOPUP` updated to the $10 id in Vercel Production; prod redeployed
  (nibbin.com 200). **Still John's (out-of-band):** confirm the signed Anthropic no-training
  agreement + publish nibbin.com/subprocessors listing Anthropic (currently 404) BEFORE data-ai/
  privacy route — the prod key is live now, so a real user reaching the model path depends on the
  contract being in place. Trivial follow-up: add `ANTHROPIC_API_KEY` to Vercel **Preview** via the
  dashboard (CLI wouldn't take the piped value).

## Previous gate (M4+M5)

- Milestone: M4+M5 — COMBINED GATE RUN 2026-06-12 on integrated main (`41b4d47` + fix PR #38),
  SIGNED by John W. 2026-06-12 (LEARNINGS.md). **No live P0/P1 after the in-gate fix**: the one live
  P1 (nearGraduation counted all decisions as graduation progress — pg-arc-data.ts, post-rebase
  code) was fixed + DB-tested in PR #38 during the gate. Two claims P1s are forward-coupling
  conditions on #29 (account-deletion clock structurally impossible while audit_log/credit_ledger
  are RESTRICT + DELETE-blocked; scan-results disconnect purge has no mechanism) — both convert to
  P0 when data-ai/privacy route. P2 sweep in #39–#46, P3 sweep in #47, cost/router additions
  appended to #24's acceptance criteria.
- Merged this wave: brand wordmark v1.0 (PR #37, `c2de2a0`), M4 scan+shop+runtime (PR #36,
  `8fae27f`), M5 drip+email (PR #35, `41b4d47`; M5 migration renumbered 20260612000000 to clear
  the timestamp collision with M4's; stubArcData swapped for the real pg-arc-data port over M4's
  tables at rebase, with a DB test suite tests/rls/arc-data.test.ts).
- **Hosted-DB drift found and closed at this gate**: dev/staging/prod actually carried ONLY the
  M1 schema — the M2 + M3 "applied + verified on all three" claim below was wrong, and prod served
  grove/connector/shop code against missing tables until 2026-06-12. M2/M3/M4/M5 are now applied
  to all three projects and hash-verified identical (26 public tables; function-definition digest
  f816e4d07ca7906e3c52c8c8ec852b14 matches a from-disk local apply on all four databases). Apply
  discipline going forward: verify information_schema, never trust the doc claim (GOTCHAS).
- Next build milestone: **M7** (synthesis packet pipeline + diagnosis synthesis + Day-14 reveal).
  **M7 ENTRY requirements (per the signed gate triage — not backlog)**: #29's two mechanisms
  (account-deletion design for the RESTRICT/append-only ledgers; scan-results purge inside
  connection_revoke) and the remaining #46 corrections — M7's reveal runs on real data and the
  claims pages route in its wake. The journal/suppression/C8 wording is already corrected on
  reference/data-ai.html + reference/privacy.html (this gate); SPEC §6.11 still needs the
  suppression-record row (deferred — SPEC carries an unrelated work-in-progress edit).
  M4 hard conditions stand: #24 (durable budget + C11 opt-in with first real `generate`, now also
  carrying the router origin-enforcement + top-up pricing criteria; all latent — zero frontier/
  free/local models are wired on main), #26 (C8 grant writer before IG/QB), #28 (webhook
  seen≠processed before side-effecting handlers).
- **M7 — Data & Privacy settings surface (deferred here from the 2026-06-15 Wispr polish pass):**
  a Settings → Data & Privacy page (web + desktop) surfacing Nibbin's actual privacy posture —
  training opt-out, local-only Field Study capture (SQLCipher), what's never captured (secure
  fields / banking / health, C4/C5), the Day-14 hard stop + verified deletion receipt (C3), and the
  Grovekeeper's no-hands guarantee. Held back from the polish pass on purpose: the claims must be
  VERIFIED against the implementation (not written blind) and any toggles wired to real settings —
  so it belongs with M7's deletion/data work, not a cosmetic sweep.
- **Maya-demo parity backlog** (`docs/tasks/maya-demo-parity.md`): the landing's interactive
  "Maya's grove" demo portrays features not yet built — time-saved metrics + the visual workflow
  map + automatable%/friction (Group A, overlaps M7's diagnosis synthesis); a "Your Nibbins" roster
  with Agent School progress / what-it-learned / streaks / badges (Group B); the "Hatch Your Own"
  builder wizard (Group C); and a richer Today approval feed (Group D). Tracked, not yet scheduled.
- **Field Study cloud sync (Phase 2) — BUILT 2026-06-15** on `feature/nibbin-desktop-unified-app`
  (spec/plan under `docs/superpowers/`). Closes the loop: at study end the desktop segments its
  redacted events into the cloud's diagnosis-packet shape ON-DEVICE (new
  `packages/redaction/src/segment.ts` `segmentStudy` — only categorized workflow summaries leave,
  never the event stream; C1/C7), uploads Bearer-authed to `/api/study/packet` (endpoint gained a
  Bearer path + idempotent upsert on a new `diagnoses.study_id`, migration `20260615120000` applied
  to DEV only), and advances the study (`synthesis_complete`) ONLY after a 200 — so raw deletion
  never precedes the packet leaving the device (C3). A root drift-guard test pins the segmenter
  output to the cloud validator. NOT yet merged; prod migration + web-origin/handoff wiring pending
  branch-land with explicit OK.
  - **Retention decided (2026-06-15):** keep auto-deleting raw (events + frames) at study end — the
    trust anchor. The redacted packet *becomes* the diagnosis and persists until account close (#29),
    so findings survive; only the raw substrate is deleted. To preserve future re-analysis as models
    improve, **enrich the retained packet** (chosen over user-controlled raw retention).
  - **Packet enrichment — SHIPPED 2026-06-15** (spec/plan under `docs/superpowers/`): the packet now
    retains bounded re-minable structure — per-workflow `sequences` (top repeated role_path#action
    chains), `urlTemplates`, `dailyMinutes`, plus top-level `dailyAppMinutes` — all clamped by the
    validator (untrusted input) and kept under the 256KB `diagnoses.packet` cap (size-bound test). And
    it CONSUMES `sequences` now: a v0 `automatable` score per workflow (computed server-side in
    `synthesizeDiagnosis`, shown as a `~X% automatable` badge in the reveal) — advances Maya-demo
    Group A.
  - **Finer re-mining — SHIPPED 2026-06-15** (`2026-06-15-finer-remining-design.md`): `automatable`
    now also consumes `urlTemplates` (narrowness) + `dailyMinutes` (regularity) to sharpen the score
    (repetition stays the gate; absent enrichment collapses to the prior formula — backward
    compatible), and `friction` is mined into a factual line (steps × repeats × views × days). Opus
    pass still warms it. Remaining: split coarse keys (`email.general` → inquiries/overdue/…) and
    consume top-level `dailyAppMinutes` — separate finer-mining follow-ups.
  - **Ad-hoc Quick Scan (Phase 3) — SHIPPED 2026-06-15** (`2026-06-15-adhoc-quick-scan-design.md`):
    capture + diagnose ONE workflow on demand, reusing the whole pipeline. Studies are now SEQUENTIAL
    with **unique ids** (fixes a latent overwrite bug — every study previously upserted the same
    `study_local` diagnosis row); each carries `kind` (`full_study`/`quick_scan`) + optional `label`.
    Study machine (Rust `nibbin-study` + its TS twin, kept identical) gained `StudyKind`, `label`,
    `CreateStudy` (valid only from terminal/NotStarted), and a per-kind auto-stop window (14d full /
    6h quick — full study byte-identical). Daemon mints unique boot ids + handles `create_study`
    (clears the store via `destroy_raw_data`). `kind`/`label` ride the packet → diagnosis
    (migration `20260615130000`, DEV only). Desktop: a "Quick scan a task" entry (label input → short
    consent variant → start → "Stop scan", no 14-day countdown) + "start another" from terminal
    states. Web: unified diagnoses **history** (newest-first, `Quick scan`/`14-day study` badges) +
    per-diagnosis detail route (`/app/diagnosis/[id]`, RLS + account-scoped); the reveal extracted to
    a shared `DiagnosisReveal`. NOT merged; prod migrations (`…120000`, `…130000`) pending land.
  - **Backlog pass — SHIPPED 2026-06-15** (the "everything" sweep): **Richer diagnosis** — split
    coarse workflow keys by `(category, subkey)` so e.g. payments→`payments.invoices` (better
    `recommendedNibbin`); `synthesizeDiagnosis` now consumes `dailyAppMinutes` → `appAllocation` and
    derives `timeSavedPerWeek` (Σ hours×automatable%) on `DiagnosisMap`
    (`2026-06-15-richer-diagnosis-design.md`). **Group A reveal** — server-rendered SVG workflow map
    (deterministic radial layout, hours-sized, automatability-colored, friction hotspot) + time-saved
    headline + stats chipline + app-allocation bars in `DiagnosisReveal`. **Per-diagnosis delete**
    (account-scoped server action, danger zone on the detail page). **Maya parity surfaces** (real data,
    demo as pixel spec): **Your Nibbins roster** (`/app/nibbins` — Agent School ladder + streaks/badges
    derived from real `runs`/`approvals`, no fabrication; "learned" narrative omitted honestly);
    **Hatch Your Own** (`/app/hatch` — 3-step wizard creating a custom-named egg via the real
    `adoptTemplate` path, caps enforced); **rich Today feed** (`/app` — time-saved chipline [estimated
    from step counts, marked `~` + footnoted], draft cards on the real `decide_run` path, "Done while
    you were working", honest "Coming up"). All typecheck + build green; none merged.
  - **Quality refinements — SHIPPED 2026-06-15:** Opus labeling may now REFINE a coarse workflow key
    to an allowed finer key (`email.general`→`email.inquiries`, re-deriving the rec; cross-category
    rejected); a confirm dialog gates per-diagnosis delete (client island); per-Nibbin **"learned about
    you"** note on the roster — Opus-generated but GROUNDED in real run/approval evidence (no
    fabrication), cached on `nibbins` (migration `20260615140000`, DEV only), generated off the render
    path; router gained an Opus-pinned `nibbin_note` task.
  - **Security pass — DONE 2026-06-15** (`docs/security/2026-06-15-security-pass-findings.md` +
    installer/desktop threat model). 5 analyses over the 72-commit diff. Web authz/RLS/migrations
    STRONG (every service-role write account-scoped; no IDOR; LLM output renders as text, no XSS). The
    headline desktop "HIGH" (Grove webview calls `access_token`) was a **false positive** — Tauri 2
    denies remote origins access to custom commands by default (verified against framework source), so
    no `remote` capability = no exploit. Fixed: `refreshLearnedNote` cooldown (caps the Opus cost-loop
    — the scaled-abuse concern), URL/HTML stripping on stored LLM prose, handoff-token hardening,
    desktop CSP pin + `script-src`, `create_study` bounds, Grove navigation lock, and dropped the
    orphaned `desktop_auth_codes` credential table (migration `20260615150000`). Pre-signing follow-up:
    **pin CI actions by SHA before enabling Windows code-signing** (signing currently dormant). Cost
    answer: signing is build-time, downloads are free GitHub serving → **mass downloads cost $0**.
  - **Landed via PR #88 (2026-06-15):** all CI green (incl. semgrep SAST). At-merge ops done — the four
    migrations (`20260615120000/130000/140000/150000`) **APPLIED to PROD** (`oaymttudfazqaqequrke`) +
    verified (diagnoses +study_id/kind/label, nibbins +learned_note*, desktop_auth_codes dropped); the
    **Grove handoff activated** (`NIBBIN_GROVE_HANDOFF=1` wired into the desktop release build;
    `/desktop-auth` ships to prod with the merge). **Windows build left beta-gated/unsigned** (deferred
    per request — Azure dormant). CI fixes en route: cargo fmt, a stale `new_study` call in the daemon
    integration test, and three eslint issues (subagents ran tsc but not fmt/eslint).
  - **Deliberately deferred (not v1):** **concurrent studies** (kept sequential — a quick scan during a
    live field study is largely redundant); **scan scheduling** (ad-hoc quick scan already covers
    on-demand scanning — recurring reminders are marginal v1 value for heavy daemon work); **packet
    compression** (the field caps already keep a 14-day study under the 256KB cap — a non-problem until
    a pathological study appears). Open finer-mining follow-up: Opus-driven finer keys in `label.ts`.

## Previous gate (M2+M3+M6)

- M2+M3+M6 — COMBINED GATE RUN 2026-06-11 on integrated main (`ba047cf`), SIGNED by John W.
  2026-06-11 (PR #32). **No P0. No live-exploitable P1.** Five P1-labeled findings are
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
  SUPERSEDED (onboarding-chat-integration): the full-bleed `/app/grove` route was retired — the
  Keeper now lives in the docked panel on Grove Home (`/app`) for daily chat and in the focal
  `OnboardingCanvas` during first run. The chat core was extracted to `KeeperChat` (variant
  `focal`|`panel`); `/app/grove` now 307-redirects to `/app`. State machine + RPC unchanged.
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
  `swbbydpuiilnamnyhwnr`, prod `oaymttudfazqaqequrke`. ALL migrations through 20260612000000 (M5)
  applied 2026-06-12 + hash-verified identical on all three (see gate entry above; the prior
  "applied + verified" claim for M2/M3 was wrong — they were missing from every hosted project).
  M2+ applications are tracked in supabase_migrations; the M1-era applications predate tracking.
  Secrets in GitHub env secrets + Vercel production. Auth redirect allow-lists exact (no wildcards).
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
- (Both combined gates are signed: M2+M3+M6 on 2026-06-11 via PR #32, M4+M5 on 2026-06-12.)
- ROTATE the Supabase access token + the Vercel token (both shared in chat; all uses complete).
- Swap Stripe to LIVE keys before real launch (prod runs test-mode Stripe now).
- Provide Google Cloud + Meta developer accounts → enable Google/Apple auth providers + file the
  two approvals (the only remaining M1 items).
- Free-tier (Hatchling) monthly credit refresh is a later scheduled job (deferred; new accounts
  start at 0 credits until a grant/subscription).
