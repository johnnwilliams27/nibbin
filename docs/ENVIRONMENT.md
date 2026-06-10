# ENVIRONMENT — deploy targets & external services (detail: SPEC §6.8)

- GitHub: repo `nibbin`; Actions CI; environments dev/staging/prod with scoped secrets;
  signed desktop artifacts to Releases (Tauri updater source). Actions pinned by SHA.
- Supabase: one project per environment (org `Nibbin`, paid plan, region us-east-2,
  Postgres 17). Project refs (non-secret): **dev** `oqnqzytctwlptfdvyagl`, **staging**
  `swbbydpuiilnamnyhwnr`, **prod** `oaymttudfazqaqequrke`. M1 migration applied + verified
  on all three (8 tables, RLS on every table, 8 policies, append-only triggers, security_invoker
  balances view). Postgres + RLS, Auth (magic link/Google/Apple), Vault for connector tokens (C9).
  Migrations in `supabase/migrations/`, applied via the Management API query endpoint (no DB
  password needed). PITR enabled; restore drill quarterly (see RISKS).
  - **Secrets** live as GitHub *environment* secrets (`dev`/`staging`/`prod`): `NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`
    (staging/prod also carry `SUPABASE_DB_PASSWORD`). Local dev reads `apps/web/.env.local`
    (gitignored). The new `sb_publishable_*`/`sb_secret_*` API keys are used, not legacy anon/service JWTs.
  - **TODO (John):** rotate the personal access token shared in chat; set the same Supabase vars
    as Vercel env (Production/Preview) so deploys can reach Supabase, or hand over a Vercel token.
- Vercel: apps/web + apps/admin; preview per PR; staging.nibbin.com; prod nibbin.com + app.nibbin.com; **admin.nibbin.com** (separate app, staff SSO + passkeys, no shared session with product).
  Env vars mirrored from GitHub environments.
- DNS (nibbin.com): apex/www/app -> Vercel. hello@nibbin.com on workspace email.
  Transactional + Field Notes mail from mail.nibbin.com via Resend/Postmark
  (SPF/DKIM/DMARC; root reputation protected). Unsubscribe + suppression list wired
  before first drip send.
- Domain: registrar lock + DNSSEC + auto-renew. Actions→cloud via OIDC (no long-lived keys). mail.nibbin.com warm-up ramp before drip launch.
- Stripe: per-env keys; webhook endpoints per env, signature-verified; Radar on.
- LLM providers: primary + fallback configured per routing tier (SPEC §6.3); provider
  hard spend caps set; routing config hot-reloadable.
- Desktop signing: Apple Developer ID + notarization; Windows code-signing cert.
  Unsigned builds never leave CI.
