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
  - **apps/admin deployed (2026-06-11):** separate Vercel project `nibbin-admin` (root
    `apps/admin`, linked to the repo — pushes to `main` auto-deploy). Env set
    (Production + Preview): prod Supabase trio, `NEXT_PUBLIC_SITE_URL=https://admin.nibbin.com`,
    and the five Sentry vars pointing at `nibbin-admin`. First deploy built clean; source
    maps uploaded. Raw `*.vercel.app` URL is 401 by design (Vercel deployment protection;
    custom domain bypasses it).
  - **TODO (John) — two steps to make admin.nibbin.com live:** (1) nibbin.com DNS is on
    Cloudflare, so add a CNAME: `admin` → `cname.vercel-dns.com`, **DNS-only/grey cloud**
    (Cloudflare proxy breaks Vercel TLS issuance). Domain is already attached to the
    project; it serves as soon as the record exists. (2) Add the admin redirect URL to the
    **prod** Supabase auth redirect allow-list (exact, no wildcards) so staff magic-link
    sign-in works on the new domain.
- DNS (nibbin.com): apex/www/app -> Vercel. hello@nibbin.com on workspace email.
  Transactional + Field Notes mail from mail.nibbin.com via Resend/Postmark
  (SPF/DKIM/DMARC; root reputation protected). Unsubscribe + suppression list wired
  before first drip send.
- Domain: registrar lock + DNSSEC + auto-renew. Actions→cloud via OIDC (no long-lived keys). mail.nibbin.com warm-up ramp before drip launch.
- Stripe: per-env keys; webhook endpoints per env, signature-verified; Radar on.
  - **Test-mode set up (2026-06-10):** products + prices created — Grove `grove_monthly` $19/mo,
    Canopy `canopy_monthly` $49/mo, top-up `credit_topup` $5 one-time. Price IDs in
    `STRIPE_PRICE_GROVE/CANOPY/TOPUP`. Webhook endpoint `we_…` registered at
    `https://nibbin.com/api/stripe/webhook` (checkout.session.completed, invoice.paid,
    customer.subscription.updated/deleted). Billing code in `apps/web` (`lib/billing`, `lib/stripe`,
    `app/billing`, `app/api/stripe/webhook`); the webhook writes subscription rows + credit grants
    via the **service role** (server-only).
  - **Local demo (tiers purchasable in test mode):** run `apps/web` against dev Supabase + test
    Stripe with the CLI forwarding webhooks: `stripe listen --forward-to
    localhost:3000/api/stripe/webhook`, set the printed `whsec_…` as `STRIPE_WEBHOOK_SECRET` in
    `apps/web/.env.local`, pay with test card `4242 4242 4242 4242`.
  - **Vercel production env:** Stripe vars + `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SITE_URL` set.
    **TODO (John):** prod Supabase **publishable + secret keys** still need setting in Vercel —
    needs a fresh Supabase access token (the chat-shared one was rotated). Swap Stripe to live keys
    before real launch.
- Sentry: error monitoring + tracing wired in apps/web and apps/admin (one Sentry project
  per app). Org `nibbin` (https://nibbin.sentry.io, US region). Projects: `nibbin-web`,
  `nibbin-admin` (created 2026-06-11; both verified ingesting via test events). Env per
  Vercel project: `NEXT_PUBLIC_SENTRY_DSN` (client) + `SENTRY_DSN` (server/edge);
  source-map upload additionally needs `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
  (build-time secret). All five SET on the `nibbin` Vercel project (Production + Preview)
  pointing at `nibbin-web`. DSNs are public (retrievable in Sentry → project settings →
  Client Keys). Web replay is error-only with full masking; admin has no replay (staff
  screens show member data — prod data never leaves prod).
  - The five vars are also set on the `nibbin-admin` Vercel project with
    `SENTRY_PROJECT=nibbin-admin` + the nibbin-admin DSN (2026-06-11; upload verified).
  - **Token note:** `SENTRY_AUTH_TOKEN` is the org auth token `nibbin-sourcemaps-vercel`
    (source-map upload scope only; created 2026-06-11 after the original chat-shared user
    token was rotated out, deleted, and verified revoked). To rotate again: mint a new org
    token at Sentry → org settings → Auth Tokens, update the Vercel var (Production +
    Preview), delete the old one — only source-map upload depends on it.
- LLM providers: primary + fallback configured per routing tier (SPEC §6.3); provider
  hard spend caps set; routing config hot-reloadable.
- Desktop signing: Apple Developer ID + notarization; Windows code-signing cert.
  Unsigned builds never leave CI.
