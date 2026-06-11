# GOTCHAS — traps already paid for (append; newest first)

- Stripe subscription credit grants must be idempotent at the BILLING PERIOD, not the
  invoice. Keying to invoice.id double-grants on a mid-period upgrade (the proration is a
  new invoice in the same period). Use `subscriptionGrantKey(subId, item.current_period_start)`
  and the unique `(account_id, source_id) where reason='grant'` index. Also: only grant when
  `invoice.amount_paid > 0` — a $0/trial invoice otherwise mints a free month. `current_period_*`
  live on the SubscriptionItem in current Stripe API, not the Subscription.
- OPEN follow-up (before the account audit-log UI ships): `audit_log_member_read` lets a product
  user read their own account's audit rows — which currently include staff EMAIL (`actor_id`) and
  internal free-text `meta.reason` (e.g. fraud-investigation notes). Redact staff identity/notes
  from the member-visible projection (a member-facing RPC/view) before any product surface renders
  audit_log. The invariant only requires the member to see THAT staff acted, not who or why.
- Stripe webhook → ledger has only pure-builder unit tests, no integration test of the route's
  grant gate. The two gate P1s lived exactly there. Add a `handleSubscription` integration test
  ($0 invoice, two same-period invoices, two different-period invoices) before extending billing.
- credits.ts refund logic is validated only in TS (`validateAppend`); the DB does not cap refunds
  or require a tier-amount for grants. No M1 writer hits `reason='run'|'refund'` (M4), but when the
  run/refund writer lands, enforce the per-run refund cap in a security-definer function under
  per-account serialization — don't rely on the app layer.

- Magic-link `emailRedirectTo` (and any auth redirect origin) must be PINNED from
  env, never derived from the request `Host` header — Host is attacker-controllable,
  so a reflected origin lets a genuine Nibbin email point its link at an attacker
  domain that harvests the PKCE code. Use `lib/site-url.ts` (`NEXT_PUBLIC_SITE_URL`
  → `VERCEL_URL` → localhost). The Supabase redirect allow-list is the second gate —
  keep it to EXACT callback URLs, never `/**` wildcards (wildcards re-open the hole).
  Preview deploys therefore don't do magic-link sign-in; test auth on dev/staging.
- First-sign-in account bootstrap is reachable from two places (the auth callback
  and every /app load). A check-then-create in app code double-creates on the first
  sign-in race. Bootstrap goes through `bootstrap_account` (advisory-locked,
  self-scoped SELECT) so it's idempotent at the DB layer — don't reintroduce an
  app-side "does the user have an account?" read to gate creation.
- RLS attack tests must run migrations as a NON-superuser owner. The CI Postgres
  container connects as `postgres` (a superuser that owns every table); a superuser
  bypasses un-forced RLS *and* can `DISABLE TRIGGER`/`set session_replication_role`,
  so append-only and owner-bypass tests can false-pass. The harness creates a
  `nibbin_owner` role (nosuperuser) and `set role`s to it for migrations, matching
  Supabase prod where `postgres` owns but isn't superuser. Default privileges are
  keyed to the creating role — set them `FOR ROLE nibbin_owner`, not bare.
- RLS is intentionally NOT forced (`force row level security`) on account tables:
  the `create_account_with_owner` security-definer bootstrap relies on the owner
  bypassing the (absent) memberships INSERT policy. Consequence: any owner-owned
  view/secdef reader over these tables bypasses RLS — `credit_balances` is safe only
  because it's `security_invoker = true`. There's a guard test that fails if any
  public view isn't security_invoker; keep it.
- Membership policies gate on `status = 'active'` via `private.is_account_member`.
  A suspended/invited member must read nothing — don't drop the status filter when
  touching that helper (regression-tested).

- Vercel + npm-workspaces monorepo: with Root Directory = `apps/web`, Vercel's build runs a
  *production* install (`NODE_ENV=production`) that omits root-level devDependencies, so Next's
  build-time TS-setup check and ESLint step fail ("typescript … not installed"). Fixes that stuck:
  (1) `eslint.ignoreDuringBuilds` + `typescript.ignoreBuildErrors` in next.config — CI already
  gates typecheck/lint, the deploy should only compile; (2) put `typescript` + `@types/node` in
  the app's *dependencies* (not devDeps) so the prod install keeps them. Vercel reads `vercel.json`
  from the Root Directory, not the repo root — a repo-root vercel.json is silently ignored.

- Pushing `.github/workflows/*` fails with the `gh` OAuth token (no `workflow` scope:
  "refusing to allow an OAuth App to create or update workflow"). Use the Windows credential
  manager helper: `git -c credential.helper=manager push`. `gh` API calls are unaffected.
- Branch protection via the API returns 403 on private repos without GitHub Pro
  ("Upgrade to GitHub Pro or make this repository public"). Don't burn time scripting it;
  it needs a plan/visibility decision.
- Creature engine is the single sink feeding `dangerouslySetInnerHTML` everywhere (app, chat,
  email, marketing). Treat every `BuildOptions` field as untrusted at `buildCreature` —
  `color`/`size` are validated there (`safeColor`/`safeSize`); never add a new species/part that
  interpolates a raw option into SVG without routing through that validation. `shade()` throws on
  non-hex by design.
- `tsc` `noUncheckedIndexedAccess` is OFF repo-wide (kept full `strict` otherwise) because the
  engine's per-stage `[a,b,c][i]` indexing is pervasive; re-enabling it means a non-null-assertion
  sweep through ported geometry. Don't "fix" indexing errors by turning it back on piecemeal.
- The redaction-corpus leak-walk must scan the WHOLE repo (minus the corpus dir), not just
  `apps/`+`packages/` — a sentinel leaking into a `.sql` migration or a `reference/*.html` page is
  exactly the deploy-time leak the control exists to catch. The test now has a census guard that
  fails if the walk stops covering a shipped top-level dir.
- `next/font/google` self-hosts fonts at build (no runtime Google CDN hit). For a privacy-forward
  brand, prefer it over `<link>` to fonts.googleapis.com (which leaks visitor IPs). The canonical
  `tokens.css` keeps bare family names as cross-surface fallbacks; the web app maps the token vars
  onto the next/font CSS variables in `globals.css`.

- Landing-page reveal system assigns .reveal from a JS selector config; adding the
  class by hand in markup leaves elements at opacity:0 forever (invisible but taking
  layout space — looks like mystery whitespace). Register selectors in the groups
  array instead.
- Creature v2: Keeper ignores all customization args by design — tests must not treat
  the always-coral blush as a palette leak (blush is brand-constant on every species).
- Creature v2: cel shading uses per-instance clipPath ids; like gradients, duplicate
  ids across instances corrupt rendering — always route through mass()/_uid.
- Creature engine: every render must generate unique SVG gradient IDs; duplicate defs
  IDs across instances silently recolor creatures.
- prefers-reduced-motion must yield feature parity, never hidden content; reveal systems
  may not depend on JS or motion to make content visible.
- Redaction fail-closed: if the Presidio sidecar is down, do NOT persist unredacted
  strings; the Rust regex battery runs regardless, and persistence blocks on layer 3.
- Scripted batch edits: a failed assertion mid-script means earlier replacements in that
  run never persisted — verify file state after any aborted batch.
- Google restricted scopes (gmail.readonly and up) trigger OAuth verification + annual
  CASA assessment with weeks-to-months lead time; unverified apps cap at 100 users.
