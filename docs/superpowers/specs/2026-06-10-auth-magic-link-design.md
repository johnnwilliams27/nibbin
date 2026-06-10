# Auth (magic-link) + account bootstrap — design

**Date:** 2026-06-10 · **Milestone:** M1 · **Surface:** `apps/web`
**Status:** approved (decisions confirmed in session)

## Goal
Wire Supabase Auth into the Day One web app: a first-time user can sign in by email
magic link, gets an account + owner membership created atomically, and lands on a minimal
authenticated page that reads their account and credit balance **through RLS** — proving the
M1 stack (auth → membership → RLS → derived balance) end to end. Google/Apple are shown but
disabled until their OAuth credentials exist.

## Decisions
- **Methods:** magic-link live now; Google/Apple buttons rendered **disabled** ("coming soon").
- **Bootstrap:** on first sign-in, auto-create the account + owner membership via the
  `create_account_with_owner` security-definer function (PR #5), with a default name derived
  from the email local-part. Returning users skip creation. Real "name your grove" UX is M2.
- **Landing `/app`:** minimal dashboard — "signed in as {email} / {account name} / {N} credits",
  the reads performed with the user's own RLS-scoped session.

## Architecture
- **`@supabase/ssr`** cookie-based sessions:
  - `lib/supabase/client.ts` — browser client (publishable key).
  - `lib/supabase/server.ts` — server client bound to the request cookie store (publishable key).
  - `middleware.ts` — refreshes the session cookie on each request; redirects unauthenticated
    users away from `/app`, and authenticated users away from `/login`.
- **Routes:**
  - `/login` — email field → `signInWithOtp`; disabled Google/Apple buttons. Server-rendered.
  - `/auth/callback` — route handler: exchange the code for a session, run bootstrap, redirect
    to `/app` (or back to `/login?error=` on failure).
  - `/app` — server component: load user, ensure bootstrap, read account + `credit_balances`
    through RLS, render the minimal dashboard with a sign-out action.
  - `/auth/signout` — POST route clearing the session.
- **Bootstrap unit:** `lib/auth/bootstrap.ts` exposes `defaultAccountName(email)` (pure,
  unit-tested) and `ensureAccount(serverClient)` which checks for an existing membership and
  calls the RPC only when none exists (idempotent — safe on every `/app` load and on callback).

## Data flow
1. User submits email at `/login` → `signInWithOtp({ email, emailRedirectTo: /auth/callback })`.
2. User clicks the emailed link → `/auth/callback?code=...` → `exchangeCodeForSession`.
3. `ensureAccount` runs: if the user has no membership, call `create_account_with_owner(defaultName)`.
4. Redirect to `/app`; the page reads `accounts` + `credit_balances` via the RLS-scoped session.

## Security / invariants
- Publishable key only on client and server-rendered reads; the `sb_secret_*` key is **not**
  used in this PR (no service-role calls — every read goes through the user's RLS session, which
  is the point of the demonstration). C-claims unaffected.
- Bootstrap is idempotent and relies on the DB-side per-user owner cap (PR #5 F2 fix).
- All user-facing copy follows the brand-voice skill and locked vocabulary (grove, hatch, etc.;
  never "bot"/"assistant").

## Testing
- `defaultAccountName` — pure unit tests (local-part extraction, normalization, fallbacks).
- `ensureAccount` — unit test against the live RLS test Postgres (reuse `tests/rls` harness
  pattern): first call creates account+membership, second call is a no-op; verified through the
  authenticated session.
- Database RLS behavior already covered by `tests/rls`.
- Manual: magic-link round trip on the dev project (documented; needs a real inbox).

## Out of scope (later milestones)
- Google/Apple provider wiring (needs OAuth creds — task #4).
- Grove scene, Grovekeeper chat, onboarding naming flow (M2).
- Desktop deep-link auth (M6).
