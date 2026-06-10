# infra/

Deployment and environment configuration (SPEC §6.8, docs/ENVIRONMENT.md).

- GitHub Actions workflows live in `.github/workflows/` (pinned by commit SHA).
- Supabase migrations live in `supabase/migrations/` (Supabase CLI; never dashboard-only).
- Vercel project config lives in `apps/web/vercel.json` + the Vercel dashboard
  (env vars mirrored from GitHub environments — never hand-edited in one place only).
- Actions → cloud auth uses OIDC federation; no long-lived cloud keys in secrets.
