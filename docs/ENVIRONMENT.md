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
  - **TODO (John):** rotate the personal access token shared in chat.
  - **Supabase keys in Vercel FIXED (2026-06-11):** the stored `SUPABASE_SECRET_KEY` had
    gone stale (rotated in the dashboard at some point; "Invalid API key" against prod) —
    service-role paths (Stripe webhook ledger grants, admin staff lookups) were broken
    while it was stale. Current prod secret set on BOTH Vercel projects (web Production,
    admin Production+Preview), both redeployed and serving. **Check Stripe webhook
    delivery logs** for failed events during the stale window and replay if any.
    john@nibbin.com provisioned as staff `superadmin` (auth user + staff_users row).
- Vercel: apps/web + apps/admin; preview per PR; staging.nibbin.com; prod nibbin.com + app.nibbin.com; **admin.nibbin.com** (separate app, staff SSO + passkeys, no shared session with product).
  Env vars mirrored from GitHub environments.
  - **apps/admin deployed (2026-06-11):** separate Vercel project `nibbin-admin` (root
    `apps/admin`, linked to the repo — pushes to `main` auto-deploy). Env set
    (Production + Preview): prod Supabase trio, `NEXT_PUBLIC_SITE_URL=https://admin.nibbin.com`,
    and the five Sentry vars pointing at `nibbin-admin`. First deploy built clean; source
    maps uploaded. Raw `*.vercel.app` URL is 401 by design (Vercel deployment protection;
    custom domain bypasses it).
  - **admin.nibbin.com LIVE (2026-06-11):** Cloudflare CNAME `admin` → `cname.vercel-dns.com`
    added (DNS-only/grey cloud — Cloudflare proxy breaks Vercel TLS issuance; keep it grey).
    Verified: global DNS resolution, TLS issued, `/login` 200, `/` 307→login. Staff
    magic-link sign-in verified end-to-end 2026-06-11. Gotcha for future domains: the prod
    Supabase redirect allow-list entry must be the EXACT callback path
    (`https://admin.nibbin.com/auth/callback`) — an origin-only entry silently falls back
    to the site URL and dumps the `?code=` on nibbin.com.
- DNS (nibbin.com): apex/www/app -> Vercel. hello@nibbin.com on workspace email.
  Transactional + Field Notes mail from mail.nibbin.com via Resend/Postmark
  (SPF/DKIM/DMARC; root reputation protected). Unsubscribe + suppression list wired
  before first drip send.
- Domain: registrar lock + DNSSEC + auto-renew. Actions→cloud via OIDC (no long-lived keys). mail.nibbin.com warm-up ramp before drip launch.
- Stripe: per-env keys; webhook endpoints per env, signature-verified; Radar on.
  - **Test-mode set up (2026-06-10):** products + prices created — Grove `grove_monthly` $19/mo,
    Canopy `canopy_monthly` $49/mo, top-up `credit_topup` (now **$10**/1,000 credits — see M6.5
    note below). Price IDs in `STRIPE_PRICE_GROVE/CANOPY/TOPUP`. Webhook endpoint `we_…` registered at
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
  - **M6.5 top-up reprice (2026-06-12):** test-mode top-up price recreated at **$10/1,000 credits**
    (`price_1ThadWE6MwGkrdl0jbJOh2hM`), set as the product default; the old $5 price archived.
    `STRIPE_PRICE_TOPUP` in `apps/web/.env.local` updated. **TODO (John):** update `STRIPE_PRICE_TOPUP`
    in the Vercel prod env to the new id (and recreate the equivalent price in **live** mode at launch).
- **Model API (Anthropic) — wired at M6.5 (2026-06-12):**
  - `ANTHROPIC_API_KEY` — server-only (never `NEXT_PUBLIC_`, never in a client bundle; read in
    `apps/web/lib/llm/client.ts`). Local dev in `apps/web/.env.local` (gitignored). **TODO (John):**
    add as a GitHub `dev`/`staging`/`prod` environment secret + the Vercel prod env before the model
    path serves real users. Absent key → every model path falls back to its honest no-model behavior
    (scripted keeper floor, deterministic drafts) with zero spend — nothing breaks.
  - Optional per-env overrides (defaults in `@nibbin/router`, founder decision 2026-06-12 — T1 Haiku
    4.5, T2 Sonnet 4.6, Opus 4.8 pinned to diagnosis): `NIBBIN_MODEL_T0/T1/T2` (model id strings),
    `NIBBIN_FRONTIER_BUDGET` (daily T2-from-chat grants/user, default 5). Any model change gates on
    the eval suite (`npm run evals`; SPEC §9).
  - **Eval CI**: `npm run evals` makes real model calls (~few cents/run). Runs when `ANTHROPIC_API_KEY`
    is present; set `NIBBIN_REQUIRE_EVALS=1` on the model-change workflow so a missing key FAILS the
    gate rather than skipping it. `NIBBIN_EVAL_MODEL_T1` overrides the eval target for candidate-model
    runs.
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
