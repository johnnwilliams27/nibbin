# LEARNINGS — milestone gate log (append-only)

Format per gate:
## M{n} — {date}
- What broke / what surprised us:
- Patterns that worked:
- Perf & cost numbers:
- Adversarial findings (counts by severity, links):
- Gate signed by: John W.

## M0 — 2026-06-10
- What broke / what surprised us:
  - `gh`'s OAuth token lacks `workflow` scope → first push of `.github/workflows/ci.yml` was
    remote-rejected. Pushed via the Windows credential-manager helper instead
    (`git -c credential.helper=manager push`). `gh` is fine for API calls, not workflow pushes.
  - Branch protection on a private repo requires GitHub Pro (403). Carried to M1 for John.
  - A Vercel GitHub integration was already wired to the repo and started auto-deploying on push;
    the monorepo build fails until root/build settings are configured. Carried to M1.
  - npm advisories on first install: vitest 2.x carried a *critical* (@vitest/mocker / UI server
    arbitrary file read+exec) — upgraded to vitest 4. Remaining 2 are moderate (next→postcss,
    dev-only) and don't trip `--audit-level=high`.
  - `tsc` with `noUncheckedIndexedAccess` exploded on the engine's per-stage array indexing
    (`[a,b,c][i]`); the reference relies on loose indexing. Relaxed that one flag repo-wide
    (kept full `strict`) rather than littering non-null assertions through ported geometry.
- Patterns that worked:
  - Validate hostile input at a single chokepoint: `safeColor`/`safeSize` in `buildCreature`
    neutralize SVG markup-injection for every species/part at once (the engine is the one sink
    feeding `dangerouslySetInnerHTML` across app/chat/email/marketing). `shade()` now throws on
    non-hex instead of emitting `#nannannan`.
  - Keeper canonicality enforced *by construction* (early return before any option is read) — the
    template the M6 capture claims should imitate.
  - The TS port was verified mechanically against the reference JS across all 5,376 renders
    (logic-skeptic), not eyeballed — byte-identical inner SVG after uid renumbering.
  - Grad-suppression now has real tests using feature-unique shade() markers (mass() only emits
    shade ±32/22/16/40, so shade 30/45/50 are flame/crest/antennae fingerprints).
- Perf & cost numbers:
  - CI ~50s for the gate job; full local CI (typecheck+lint+test+audit+build) under ~2 min.
  - Web shell: First Load JS 103 kB; 3 static routes (/, /harness, /_not-found). No LLM cost yet.
  - Engine test sweep: 23 tests, ~0.6s; exhaustive 5,376-combination render in ~0.5s.
- Adversarial findings (counts by severity):
  - red-team: 0 P0, 1 P1 (color→XSS, latent until user-influenced colors arrive), 2 P2, ~4 P3.
  - claims-auditor: 0 P0, 0 P1, 2 P2 (privacy.html missing retention table; Google Fonts flow), 4 P3.
  - logic-skeptic: 0 P0, 1 P1 (corpus leak-walk overstated coverage), 4 P2, ~5 P3.
  - All P1s + the high-value P2s fixed in this milestone before sign-off; remainder are P3 nits or
    carried env items. Engine geometry confirmed exact.
- Gate signed by: John W. (authorized in-session 2026-06-10) — DoD met; branch protection live,
  Vercel production serving over HTTPS (nibbin.vercel.app; apex nibbin.com DNS configured, cert
  provisioning), grovemap + memory + review-gate scaffolding in place, adversarial gate clean of P0/P1.

## M1 — 2026-06-10
- What broke / what surprised us:
  - **The gate caught two P1 credit-conservation bugs the per-PR reviews missed** — both at the
    webhook→ledger boundary, which had only pure-builder unit tests and no integration test:
    (1) a mid-period upgrade's proration invoice (new invoice id, same period) double-granted a
    full month; (2) a $0/trial invoice would mint a month with no payment. Fix: grant **once per
    billing period** (key the grant to `current_period_start`, not the invoice id) and only when
    `invoice.amount_paid > 0`. Lesson: idempotency keys must be chosen at the level the invariant
    lives (the period), not the most convenient id (the invoice).
  - Two access tokens died mid-operation because they were rotated as recommended (Supabase token
    twice; once it left empty Supabase keys written into Vercel). Lesson: finish all token-dependent
    work in one pass, or expect `Unauthorized` mid-script; never write fetched-as-empty values.
  - `git reset --hard` while the user had uncommitted work (docs/GTM.md) discarded it; recovered
    from the staged blob via `git fsck --unreachable`. Lesson: `git stash` before reset when any
    uncommitted work is present.
  - Stripe SDK 22.2.0 doesn't export `LatestApiVersion`; `current_period_start/end` live on the
    SubscriptionItem, not the Subscription. PowerShell mangles inline JSON to curl/Vercel/Supabase —
    always write request bodies to a file and use `-d @file`.
- Patterns that worked:
  - **DB as the last line of defense** repeatedly caught what app code alone couldn't: append-only
    triggers bind even the service role; unique `(account_id, source_id)` partial indexes make Stripe
    grants/top-ups idempotent under webhook replay; security-definer functions enforce RBAC (staff
    credit adjust) at the layer below the app `if`.
  - **Exact, wildcard-free identity lookups for authz** — the staff allowlist ILIKE→`%`-bypass P0
    was closed by an exact `lower(email)=lower(...)` RPC. Never feed user-controlled text into a
    LIKE pattern for an authz decision.
  - Pinned redirect origins (never the Host header) + exact Supabase redirect allow-lists closed the
    magic-link open-redirect class in both apps.
  - Lazy env accessors (functions, not module constants) so the CI build compiles with no secrets;
    `import 'server-only'` + non-`NEXT_PUBLIC` names keep both service-role keys off the client.
- Perf & cost numbers:
  - Full local CI (typecheck+lint+test+audit) ~10s of test runtime; 136 tests across 12 files
    (RLS/staff/billing DB suites need a Postgres service container; `fileParallelism:false` to avoid
    a schema-reset race). No LLM spend yet (router is M2). Stripe test-mode only.
- Adversarial findings (counts by severity):
  - Per-PR red-teams during the milestone: PR #5 1 P1 + 4 P2/P3; PR #8 1 P1 + 2 P3; PR #9 **1 P0**
    (ILIKE auth bypass) + 2 P1 + P2/P3; PR #12 **1 P0** (top-up idempotency) + P1/P2/P3 — all fixed
    before merge.
  - **Gate (holistic):** red-team 0 P0/P1 (1 P2 staff-PII-in-audit-log, P3s); claims-auditor clean
    bill (C8/C9 upheld by absence, append-only by construction, staff fully audited); logic-skeptic
    **2 P1** (the upgrade/$0 grant bugs) — both fixed + re-verified closed before sign-off. Remaining
    open: P2 (audit-log staff PII redaction — before the audit UI ships), P2 (upgrade doesn't
    immediately top up to Canopy — conservation-safe, product call), P3s (refund DB cap at M4,
    impersonation time-boxing, webhook integration test).
- Gate signed by: John W. (authorized in-session 2026-06-10) — M1 build scope (account hierarchy,
  RLS, credit ledger, magic-link auth, admin console, Stripe billing) gate-clean of P0/P1 after the
  2 webhook P1s were fixed + re-verified. DEFERRED by John: filing the Google OAuth/CASA + Meta
  approvals and enabling Google/Apple auth providers (need the Google Cloud + Meta accounts) —
  drafts + wiring ready, tracked in docs/STATE.md. M1 fully closes once those land.

## M2+M3+M6 (combined gate) — 2026-06-11
- What broke / what surprised us:
  - **The gate's worst live finding was an honesty bug, not a security bug**: scripted M2 chat
    consumes frontier budget and shows the degradation notice with no model wired — and the keeper
    unit test *asserted the buggy behavior* (drove budget:0, no `generate`, expected the notice).
    A test can enshrine a bug; assert the user-visible contract, not the implementation (#25).
  - **Upstream relicensing is a real supply-chain event** (M6): Screenpipe moved MIT→commercial the
    day before the work; the fork had to be pinned to the parent of the relicense commit with its
    MIT LICENSE.md preserved. "Fork it, it's MIT" is only true at a specific SHA. SPEC §9's row
    flagged for revisit.
  - **A claim is only "by construction" at the dependency boundary you can prove** (M6): C1's "no
    network" was true of nibbin-capture's own code but false of its transitive closure until the
    NER client was split into its own crate. Same lesson at the gate: C8 is structurally false at
    the provider for QuickBooks/Instagram (no read-only platform scope exists) and held instead at
    the client layer + DB immutability of `connections.scopes` (#26).
  - **Day-14 enforcement that trusts the wall clock isn't enforcement** (M6): moving the stop into
    the daemon was necessary but not sufficient — a persisted monotonic high-water mark closes the
    clock-rollback hole. Full elapsed-time accounting is an M8 hardening item.
  - **Twin implementations need a shared executable oracle** (M6): TS pipeline and Rust daemon
    share rule JSON + corpus fixtures, so "they agree" is tested, not asserted. The one behavior
    tested only against the TS sim (C6 gap logging) was exactly where a gap slipped through.
  - **Fresh sign-in had no `public.users` row** (M2): bootstrap's membership FK pointed at a row
    nothing created; the RLS suite had seeded it by hand, masking the gap until a clean local
    sign-in failed. Idempotent self-upsert now runs before the bootstrap RPC at every call site.
  - **The creature engine mints unique gradient/animation ids per render**, so SSR and hydration
    markup can never match — the Keeper sprite is mount-gated rather than fighting the warning (M2).
  - **Supabase Vault is owner-only** (M3): the test stub mirrors prod's trust boundary (only
    `nibbin_owner` reaches the vault schema), so tokens are reachable solely through the
    security-definer RPCs. Vault RPCs live in `public` with execute revoked from client roles.
  - **SSRF defense that holds** (M3): pin the connect to the validated IP (Node re-resolves
    otherwise); one private DNS answer poisons the whole answer set; reject octal/leading-zero IPv4
    outright — parser disagreement is the bypass.
  - Local-env traps at the gate: stale workspace node_modules after merged PRs added packages
    (plain `npm install`, not `npm ci`); grovemap walks from cwd.
- Patterns that worked:
  - **Structural enforcement everywhere it mattered**: keeper exports no tools (C10), capture's
    secure events have no value fields (C4 type layer), vault RPCs are service-role-execute-only
    (C9), client writes revoked at the DB (grove_state, connections). The four reviewers attacked
    all of it and it held.
  - **PR-time adversarial review + integrated gate catch different things.** PR reviews closed
    P0s inside each diff; the gate's fresh-eyes pass found the cross-PR items — Sentry configs
    (PR #16) vs connector error paths (PR #14), the router/keeper budget-vs-scripted-floor
    mismatch inside M2 itself, and the velocity-cap-backstops-C8 coupling across M3 findings.
  - **Honest deferral comments paid off**: send paths say "stage gating is M4" instead of
    pretending; the velocity TOCTOU carries an ATOMICITY CONTRACT comment; the in-memory budget
    store carries a loud not-a-real-cap warning. Reviewers verified the deferrals are real
    (nothing fakes a missing guard) — that's what kept five claims-auditor P1s conditional rather
    than live.
  - Quarantine with an unguessable per-wrap random tag + marker neutralization held against
    prompt-injection construction attempts.
- Perf & cost numbers:
  - Local CI: typecheck+lint+audit green; vitest 403 passed / 3 skipped (opt-in dev-Supabase) in
    ~14s against the pinned-digest Postgres 17 container. GitHub CI wall ~3 min, all 5 jobs.
  - LLM COGS as shipped: **$0.00/user/mo** (chat is the scripted T0 floor; zero model calls in the
    repo). Total COGS today ≈ $1.10/user (~94% gross margin).
  - Cost-auditor M4 projection (stated assumptions, Anthropic-class pricing): ≈ $11.20/user/mo on
    Grove $19 → **~41% gross margin, below the 60% target**. Top drivers: T1 specialist action
    runs (~80% of projected COGS), uncapped-monthly T2-from-chat (5/day default), Stripe fee floor.
    Levers ranked in the gate report: durable budget store, cache_control prefix discipline
    (~60–80% off input tokens), per-step T0 routing inside actions, max-tokens ceilings pre-call.
- Adversarial findings (counts by severity, integrated-main pass):
  - red-team: 0 P0, 0 P1, 2 P2 (#26 C8 scope reality, #27 Sentry beforeSend), 3 P3 (#30).
  - claims-auditor: 0 P0, 5 P1 — all forward-coupling conditions on unbuilt surfaces (#22 C6
    latency, #23 C4 OS flags, #24 C11 opt-in, #26 C8 structural grants, #29 retention) — 3 P2,
    2 P3. C1/C2/C3/C5/C7/C9/C10 verdict: enforced by construction.
  - logic-skeptic: 0 P0/P1; 1 live P2 (#25 budget/degradation lie), 1 latent P2 (#28 webhook
    seen≠processed), 3 P3 (#30). No M1 ledger/billing regression; no charter area faked.
  - cost-auditor: 0 open P1 (the in-memory budget store converts to an automatic P1 on the first
    real `generate` PR — #24), 3 P2, 2 P3. Routing table verbatim-compliant; chat defaults T0.
  - Triage stance recorded for the signature: severity judged against the shipped surface; the five
    claims-auditor P1s are tracked conditions (issues above), not live violations — nothing served
    today promises more than the code delivers. John accepts or overrules at sign-off.
- Gate signed by: John W. (authorized in-session 2026-06-11) — accepts the condition-based triage
  (issues #22–#30: five forward-coupling P1 conditions, no live P0/P1) and the two DoD caveats:
  M3 "12+ connectors live in staging" not deployment-verified; M6 "budgets met" + <100ms pause
  await macOS bring-up.

