# ENVIRONMENT — deploy targets & external services (detail: SPEC §6.8)

- GitHub: repo `nibbin`; Actions CI; environments dev/staging/prod with scoped secrets;
  signed desktop artifacts to Releases (Tauri updater source). Actions pinned by SHA.
- Supabase: one project per environment. Postgres + RLS, Auth (magic link/Google/Apple),
  Vault for connector tokens (C9). Migrations in `supabase/migrations/`. PITR enabled;
  restore drill quarterly (see RISKS).
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
