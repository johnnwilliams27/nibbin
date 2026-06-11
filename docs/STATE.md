# STATE

- Milestone: M1 — GATE RUN 2026-06-10, CLEAN of P0/P1 (awaiting John's signature in LEARNINGS.md).
  The gate caught + fixed 2 P1 credit-conservation bugs (webhook upgrade/$0 grants), re-verified
  closed. Remaining M1 work is external-only: enable Google/Apple auth providers + FILE the Google
  OAuth/CASA + Meta IG-DM approvals (needs John's Google Cloud + Meta accounts).
- M1 gate open follow-ups (non-blocking P2/P3): redact staff email/notes from member-visible
  audit_log before the account audit UI ships; webhook→ledger integration test; refund DB cap +
  impersonation time-boxing at the milestones that build them (M4/later). See LEARNINGS.md / GOTCHAS.md.
- M0: COMPLETE, gate signed by John W. 2026-06-10 (LEARNINGS.md).
- VERIFIED 2026-06-10: apex https://nibbin.com serves 200 over HTTPS; prod app serves /login (200),
  /billing (307→login), /api/stripe/webhook (405 on GET) — deployed app reaches prod Supabase +
  test-mode Stripe end to end.

## M1 — merged this milestone (all TDD'd, red-teamed, CI-green)
- PR #4: credit ledger math (packages/shared) — weights 1/3/10, tiers, $5 top-ups, never-overdraw,
  single-refund-per-run, validateAppend append-time authority. Property-tested.
- PR #5: §6.1 migration — accounts/users/memberships/subscriptions/credit_ledger/audit_log + staff
  world; RLS-via-membership; append-only triggers; create_account_with_owner. RLS attack suite in CI
  (digest-pinned Postgres service container). auth_identities → Supabase auth.identities (SPEC §9).
- PR #6: Codex CLI mirror (AGENTS.md + .agents/.codex).
- PR #8: magic-link auth + first-sign-in bootstrap (apps/web); bootstrap_account RPC (advisory-locked,
  idempotent); /app reads through the user's RLS session. Red-teamed (pinned redirect origin; signout CSRF).
- PR #9: staff admin console (apps/admin, §6.10) — magic-link staff auth gated to staff_users, account
  search, audited credit adjustment, read-only governed impersonation; service-role server-only.
  Red-team closed a P0 ILIKE-wildcard auth bypass; claims-audit added staff read-access auditing.
- PR #10: Google/Meta approval submission DRAFTS (docs/submissions/).
- PR #11: GTM strategy updates (docs/GTM.md).
- PR #12: Stripe billing skeleton (apps/web) — fixed-price subs + Canopy-only top-up; signature-verified
  webhook → idempotent ledger grants via service role (server-only); /billing + Customer Portal.
  Red-team closed a P0 top-up idempotency hole (+ P1 grant-time tier check, P2 amount-paid quantity).

## Platforms / environments
- Supabase: org `Nibbin` (paid), us-east-2, PG17. Projects: dev `oqnqzytctwlptfdvyagl`, staging
  `swbbydpuiilnamnyhwnr`, prod `oaymttudfazqaqequrke`. ALL migrations (170000/190000/210000/220000/240000)
  applied + verified on all three. Secrets in GitHub env secrets + Vercel production. Auth redirect
  allow-lists exact (no wildcards).
- Vercel: project `nibbin` (team `nibbin`). Production env complete (prod Supabase keys + test Stripe +
  site URL); prod redeployed 2026-06-10 and verified live.
- Stripe (TEST mode): products/prices created (Grove $19/mo, Canopy $49/mo, top-up $5); webhook endpoint
  `we_…` at nibbin.com/api/stripe/webhook. Local demo: `stripe listen` + card 4242… (docs/ENVIRONMENT.md).
- Branch protection on `main`: ENABLED — 4 required strict checks, PRs required, enforce_admins, linear
  history, no force-push/delete.
- Production URLs: https://nibbin.com (apex/www/app) + https://nibbin.vercel.app — all live over HTTPS.
- Repo: github.com/johnnwilliams27/nibbin (private), default branch `main`.

## M1 approval tracking (DoD = "both processes initiated and tracked here")
- Google OAuth verification/CASA: NOT YET FILED — needs Google Cloud project. Draft:
  docs/submissions/google-oauth-verification.md. Record submission + CASA dates here when filed.
- Meta App Review (IG DMs) + Business Verification: NOT YET FILED — needs Meta account. Draft:
  docs/submissions/meta-app-review.md. Record submission + business-verification dates here when filed.

## Open P0/P1: none

## Outstanding for John
- ROTATE the Supabase access token + the Vercel token (both shared in chat; all uses complete).
- Swap Stripe to LIVE keys before real launch (prod runs test-mode Stripe now).
- Provide Google Cloud + Meta developer accounts → enable Google/Apple auth providers + file the two
  approvals (the only remaining M1 items).
- Free-tier (Hatchling) monthly credit refresh is a later scheduled job (deferred; signup grant omitted
  from the billing PR to avoid churn — new accounts start at 0 credits until a grant/subscription).
