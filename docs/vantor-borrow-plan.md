# Implementation Plan: Vantor-borrow, wave 1

**Branch:** `experiment` (worktree `C:/nib-experiment`)
**Source brief:** `docs/vantor-borrow-brief.md`
**Goal of this wave:** ship the cohesion layer + the account-management gap the user
flagged, across web **and** desktop (both macOS and Windows via the shared Observer UI).

Built without per-step approval (user granted full autonomy). The only item that would
require a spec decision is **notification preferences** — deferred, see §Deferred.

---

## Scope of this wave

### Web (`apps/web`)

1. **UI kit** — `apps/web/components/ui/`
   - `Button.tsx` (primary / secondary / ghost / danger), `Card.tsx`, `Badge.tsx`
     (semantic tints), `Spinner.tsx`, `InlineFeedback.tsx` (success / error).
   - One shared `ui.module.css`, token-only. Replaces copy-pasted `.primary` buttons.

2. **App shell** — `apps/web/components/shell/AppShell.tsx` (client) + `shell.module.css`
   - Persistent left sidebar: Grove · Shop · Notifications · Billing · Settings.
   - Topbar: page title + account menu (email, Sign out).
   - Mobile: hidden sidebar + hamburger overlay + backdrop.
   - Route-mount fade (`--ease-settle`).
   - Grove scene (`/app/grove`) stays bare — its immersive ceremony must not be framed.

3. **Wrap dashboard pages in the shell** — `/app` (home), `/billing`,
   `/app/notifications`, `/app/shop`, and the new settings pages. Content preserved;
   only the outer chrome changes.

4. **Settings hub** — `apps/web/app/app/settings/`
   - `SettingsNav` sub-tabs: Profile · Security · Billing (Billing links to `/billing`).
   - `settings` → redirect to `settings/profile`.
   - **Profile** (`profile/page.tsx` + `actions.ts`): edit display name, timezone,
     locale → self-update of `public.users` (RLS `users_self_update` confirmed). Success
     banner via `?saved=1`.
   - **Security** (`security/page.tsx` + `actions.ts`): change password
     (`supabase.auth.updateUser`), and "Sign out everywhere" (`signOut({ scope: 'global' })`).

5. **Tabular numerals** — one line in `globals.css` body so credits/usage align.

### Desktop (`apps/desktop/src/ui`) — shared UI ⇒ macOS **and** Windows together

6. **Preferences tab** — `views/preferences.ts`, registered in `main.ts` nav.
   Aggregates the device-level controls that were scattered: pause state hint, add an
   exclusion (`add_exclusion`), pointer to Review for captured data, and the
   always-reachable delete-everything card. Plus a clear pointer that account settings
   live at `nibbin.com/app/settings`.

7. **Sign-out confirmation** — `views/account.ts`: arm the "Sign out on this device"
   button (two-tap), matching the delete-everything safety pattern.

---

## Patterns to follow (grounded in the codebase)

- **Pages**: server components, `export const dynamic = 'force-dynamic'`, `createClient()`,
  `ensureAccount({...})`, RLS-scoped reads. (`app/billing/page.tsx` is the template.)
- **Mutations**: `actions.ts` with `'use server'`, `FormData`, `redirect('?...')` for
  status. (`auth/set-password/actions.ts` is the template.)
- **Styling**: CSS Modules, tokens only (no hex). `app.module.css` is the template.
- **Desktop**: framework-free `el()/button()/clear()` DOM helpers + `observer.css`
  classes (`card`, `row`, `stack`, `chip`, `danger`). `views/study.ts` is the template.

---

## Verification

- `npm run -w @nibbin/web typecheck` (or `tsc --noEmit`) green.
- `npm run -w @nibbin/web lint` green.
- Desktop: `tsc --noEmit` / `vite build` for the UI; existing desktop tests still pass.
- (Capture is stubbed on both OSes regardless — out of scope for a UX/account wave.)

---

## Deferred (and why)

- **Notification preferences (web + desktop)** — *spec-gated.* `app/api/email/unsubscribe`
  states copy "must not imply an on-off switch" and "no settings toggle exists yet."
  A real preferences surface needs a `notification_preferences` table + a product
  decision about channels/granularity. Flagged for a spec call, not built here.
- **Home enrichment** (approval-queue hero, report cards, activity ledger) — wave 2;
  overlaps the planned M4.5 "Grove Home," so it gets the shell now and richer content
  after a spec alignment.
- **Connected-accounts UI** — wave 2 (connector platform exists; needs a list/revoke UX).
- **Billing depth** (invoices, usage breakdown, payment method in-app) — wave 2; today it
  correctly defers to the Stripe portal.
- **macOS `entitlements.plist` / Windows code-signing cert** — infra config, not product.
  `entitlements.plist` being wrong blocks notarization worse than being absent, and the
  Windows cert thumbprint is a real secret. Documented as a release-eng task, not faked.
