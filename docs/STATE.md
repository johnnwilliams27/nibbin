# STATE

- Milestone: M1 — IN PROGRESS (started 2026-06-10). Account hierarchy, auth, Stripe skeleton,
  credit ledger, admin console at admin.nibbin.com, file Google/Meta approvals.
- M0: COMPLETE, gate signed by John W. 2026-06-10 (LEARNINGS.md).
- VERIFIED 2026-06-10: apex https://nibbin.com serves 200 over HTTPS — M0 DoD fully closed.
  Cloudflare token that was shared in chat: ROLLED (John, 2026-06-10).
- M1 progress (also tracked in the session task list):
  - DONE (PR #4, merged): credit ledger math + property tests in packages/shared (weights 1/3/10,
    tiers, top-ups, never-overdraw, single-refund-per-run, validateAppend authority).
  - DONE (PR #5, merged): §6.1 migration — account hierarchy + credit_ledger + audit_log + staff
    world, RLS-via-membership, append-only triggers, create_account_with_owner bootstrap; RLS
    attack suite (tests/rls) in CI against a digest-pinned Postgres service container + Docker
    locally. auth_identities dropped for Supabase auth.identities (SPEC §9). Red-teamed.
  - DONE (PR #6, merged): Codex CLI mirror (AGENTS.md + .agents/.codex), paths corrected.
  - DONE: Supabase fully provisioned — dev/staging/prod projects created (us-east-2, PG17),
    M1 migration applied + verified on all three; keys stored as GitHub env secrets; dev
    apps/web/.env.local written (gitignored). Refs + secret layout in docs/ENVIRONMENT.md.
  - NEXT (credential-free): wire magic-link auth + account/owner bootstrap on first sign-in
    (apps/web) — Supabase Auth is live. Google/Apple providers still need John's OAuth creds.
- Open P0/P1: none
- M1 service credentials still needed from John:
  - Stripe: test-mode keys + webhook secret — blocks "tiers purchasable in test mode".
  - Google Cloud + Meta developer accounts — for filing OAuth verification/CASA + IG-DM app review,
    and for enabling Google/Apple auth providers in Supabase.
  - ROTATE the Supabase personal access token (shared in chat); set Supabase vars in Vercel env
    (or provide a Vercel token) so deploys reach Supabase.
- Branch protection on `main`: ENABLED (2026-06-10, after GitHub Pro upgrade) — 4 required
  status checks (strict), PRs required, enforce_admins on, linear history, no force-push/delete.
- Vercel: WORKING. Git integration deploys `apps/web` on every push to main; production is
  live and public over HTTPS at https://nibbin.vercel.app (/ and /harness both 200). Project
  config: root dir `apps/web`, install `npm install --include=dev`, typecheck/lint owned by CI.
- Carried items into M1 (non-blocking):
  - ~~nibbin.com DNS~~ DONE 2026-06-10 — apex/www/app all serve 200 over HTTPS via Cloudflare
    (DNS-only) → Vercel.
  - ~~Supabase projects~~ DONE 2026-06-10 — dev/staging/prod live, migration applied, secrets stored.
- Long-lead external processes: Google OAuth verification + CASA — NOT STARTED (file at M1); Meta app review (IG DMs) — NOT STARTED (file at M1)
- Production URLs: https://nibbin.com (apex, www, app) + https://nibbin.vercel.app — all 200 over HTTPS
- Repo: github.com/johnnwilliams27/nibbin (private), default branch `main`
