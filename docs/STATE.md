# STATE

- Milestone: M1 — IN PROGRESS (started 2026-06-10). Account hierarchy, auth, Stripe skeleton,
  credit ledger, admin console at admin.nibbin.com, file Google/Meta approvals.
- M0: COMPLETE, gate signed by John W. 2026-06-10 (LEARNINGS.md).
- VERIFIED 2026-06-10: apex https://nibbin.com serves 200 over HTTPS — M0 DoD fully closed.
  Cloudflare token that was shared in chat: ROLLED (John, 2026-06-10).
- M1 progress (also tracked in the session task list):
  - DONE (PR #4): credit ledger math + property tests in packages/shared (weights 1/3/10,
    tiers, top-ups, never-overdraw, single-refund-per-run, validateAppend authority).
  - DONE (this PR): first Supabase migration — §6.1 account hierarchy + credit_ledger +
    audit_log + staff world, RLS-via-membership on everything, append-only triggers,
    create_account_with_owner bootstrap; RLS attack suite (tests/rls) runs in CI against a
    digest-pinned Postgres service container and locally via Docker. auth_identities dropped
    in favor of Supabase auth.identities (SPEC §9 decision logged).
  - NEXT: auth sign-in flows (needs Supabase projects), Stripe skeleton (needs test keys),
    admin console skeleton, file Google/Meta approvals (needs accounts) — credentials below.
- Open P0/P1: none
- M1 service credentials needed from John (building credential-free parts first):
  - Supabase: create projects (dev/staging/prod) + provide access token / project ref + DB URL —
    blocks live RLS tests, auth providers. (RLS tests also run in CI against a Postgres service.)
  - Stripe: test-mode keys + webhook secret — blocks "tiers purchasable in test mode".
  - Google Cloud + Meta developer accounts — for filing OAuth verification/CASA + IG-DM app review.
- Branch protection on `main`: ENABLED (2026-06-10, after GitHub Pro upgrade) — 4 required
  status checks (strict), PRs required, enforce_admins on, linear history, no force-push/delete.
- Vercel: WORKING. Git integration deploys `apps/web` on every push to main; production is
  live and public over HTTPS at https://nibbin.vercel.app (/ and /harness both 200). Project
  config: root dir `apps/web`, install `npm install --include=dev`, typecheck/lint owned by CI.
- Carried items into M1 (non-blocking):
  - ~~nibbin.com DNS~~ DONE 2026-06-10 — apex/www/app all serve 200 over HTTPS via Cloudflare
    (DNS-only) → Vercel.
  - Supabase: no project created yet (no SUPABASE_ACCESS_TOKEN / CLI locally). First migration lands at M1; create projects then.
- Long-lead external processes: Google OAuth verification + CASA — NOT STARTED (file at M1); Meta app review (IG DMs) — NOT STARTED (file at M1)
- Production URLs: https://nibbin.com (apex, www, app) + https://nibbin.vercel.app — all 200 over HTTPS
- Repo: github.com/johnnwilliams27/nibbin (private), default branch `main`
