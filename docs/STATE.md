# STATE

- Milestone: M0 — COMPLETE, gate passed (awaiting John's signature in LEARNINGS.md)
- Next: M1 — account hierarchy, auth, Stripe skeleton, credit ledger, admin console, file Google/Meta approvals
- Last gate signed: M0 gate report generated 2026-06-10; adversarial reviewers clean of P0/P1 after fixes
- Open P0/P1: none
- Carried items into M1 (non-blocking):
  - Branch protection on `main` is NOT enabled — GitHub free plan blocks branch protection on private repos (403: "Upgrade to GitHub Pro or make this repository public"). PR workflow is followed in practice (PR #1 used); enforcement needs GitHub Pro, making the repo public, or org transfer. **John decision needed.**
  - Vercel: a GitHub integration is connected (project `nibbin/nibbin`) and auto-deploys per push, but the deploy fails — monorepo build settings need configuring (committed `vercel.json` with buildCommand/outputDirectory as a first attempt; needs `vercel login` to verify/inspect). nibbin.com is NOT yet served over HTTPS. **John decision/credentials needed.**
  - Supabase: no project created yet (no SUPABASE_ACCESS_TOKEN / CLI locally). First migration lands at M1; create projects then.
- Long-lead external processes: Google OAuth verification + CASA — NOT STARTED (file at M1); Meta app review (IG DMs) — NOT STARTED (file at M1)
- Production URLs: none serving yet (nibbin.com registered; Vercel project exists but deploy failing)
- Repo: github.com/johnnwilliams27/nibbin (private), default branch `main`
