# STATE

- Milestone: M0 — COMPLETE, gate passed (awaiting John's signature in LEARNINGS.md)
- Next: M1 — account hierarchy, auth, Stripe skeleton, credit ledger, admin console, file Google/Meta approvals
- Last gate signed: M0 gate report generated 2026-06-10; adversarial reviewers clean of P0/P1 after fixes
- Open P0/P1: none
- Branch protection on `main`: ENABLED (2026-06-10, after GitHub Pro upgrade) — 4 required
  status checks (strict), PRs required, enforce_admins on, linear history, no force-push/delete.
- Vercel: WORKING. Git integration deploys `apps/web` on every push to main; production is
  live and public over HTTPS at https://nibbin.vercel.app (/ and /harness both 200). Project
  config: root dir `apps/web`, install `npm install --include=dev`, typecheck/lint owned by CI.
- Carried items into M1 (non-blocking):
  - **nibbin.com DNS — needs John (Cloudflare).** The domain is added to the Vercel project but
    nibbin.com's nameservers are Cloudflare (keenan/maeve.ns.cloudflare.com). To serve the shell
    on the apex domain, add at Cloudflare (DNS-only, grey cloud): `A nibbin.com 76.76.21.21`
    (Vercel auto-provisions HTTPS after). Also add `www` and `app` per docs/ENVIRONMENT.md.
    Until then the shell is live on nibbin.vercel.app; the apex is the only gap on the M0 DoD.
  - Supabase: no project created yet (no SUPABASE_ACCESS_TOKEN / CLI locally). First migration lands at M1; create projects then.
- Long-lead external processes: Google OAuth verification + CASA — NOT STARTED (file at M1); Meta app review (IG DMs) — NOT STARTED (file at M1)
- Production URLs: none serving yet (nibbin.com registered; Vercel project exists but deploy failing)
- Repo: github.com/johnnwilliams27/nibbin (private), default branch `main`
