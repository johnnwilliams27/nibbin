# Nibbin Desktop — Unified App (Grove + Field Study)

- **Date:** 2026-06-15
- **Status:** Design approved; ready for implementation planning
- **Branch:** `feature/nibbin-desktop-unified-app`
- **Scope of this spec:** Phase 1 only (Phases 2–3 listed under Phasing)

## Problem

The installed desktop app (`apps/desktop`) is **only the Observer** — a privacy-isolated
field-study screen-capture tool. Its entire UI is `consent / study / review / notes /
account / preferences`. It contains none of the actual Nibbin product (chat, Grovekeeper,
your agents/nibbins, the Agent Shop). That product lives entirely in the web app
(`apps/web/app/app`: `grove`, `shop`, `memory`, `diagnosis`, `settings`).

Consequences a user hits today:
- The app "doesn't open" — it launches to a hidden window (`visible:false`, never shown),
  living only in the tray.
- No agent-management experience at all.
- Sign-in is a system-browser PKCE redirect (PR #79) that is also currently broken.
- "Study" should be "Field Study"; there is no obvious way to start one.

**Desired:** the desktop app IS Nibbin — open to a login screen, then a tabbed app with the
full product (**Grove**) and the field-study tool (**Field Study**) as a tab.

## Decisions (already made with the user)

1. **Native shell + embedded web UI.** Not a from-scratch native rebuild.
2. **Reuse the web React UI** by embedding it (the web app is Next.js App Router — server
   components + server actions + server-only `ANTHROPIC_API_KEY`; converting it to a bundled
   client SPA was assessed as a 4–6 week refactor *and* a security downgrade, so we embed it
   instead and keep the server-side security model intact).
3. **Native Nibbin login screen gates the whole app** — shown first, before any tab.
4. **Tabs: `Grove` | `Field Study`.** "Grove" matches the product's own vocabulary (the web
   home `/app` is titled "Your grove"; agents are *nibbins* in your grove).

## Goals (Phase 1)

- Rename the app to **Nibbin**; it opens **visible** to a native login screen.
- Native email/password login (Supabase, same shared identity as web) that gates everything
  and stores the session in the **OS keychain** (reusing `auth.rs`).
- After login: a native tabbed shell — **Grove** (embedded authenticated web product) and
  **Field Study** (native Observer UI) — with a **"Start a field study"** entry point.
- All "study" wording → "field study."
- Remove the broken system-browser PKCE redirect sign-in.

## Non-goals (deferred)

- **Phase 2:** Field Study → cloud upload using the native session; desktop-awareness tweaks
  to the embedded web UI (e.g. suppressing redundant web chrome).
- **Phase 3:** full-bleed app icon; modern NSIS installer with Nibbin branding.
- A native rebuild of any Grove screen.

(Orthogonal, already done: macOS code-signing fixed via a legacy-format `.p12`; the Windows
unsigned `.msi` download is live at `nibbin.com/download/windows`.)

## Architecture

```
Tauri window "Nibbin"  (opens visible)
 │
 ├─ on launch: Rust auth_session() reads keychain
 │     valid/refreshable ──► show Shell (default tab: Grove)
 │     none/expired      ──► show Login gate
 │
 ├─ Login gate  (shell webview, Vite/TS UI)
 │     email/password ─► supabase-js signInWithPassword
 │        success ─► invoke store_session(session) → keychain → show Shell
 │
 └─ Shell  (after auth)
       ├─ native tab bar:  [ Grove ] [ Field Study ]
       ├─ Grove   = child webview ► ${WEB_URL}/desktop-auth#<tokens> → /app  (authenticated)
       └─ Field Study = native Observer views (consent / field-study / review / notes)
```

- **WEB_URL** is pinned to `https://nibbin.com` (overridable to a dev URL via the same
  `option_env!` pattern `auth.rs` already uses for pinned origins). Never derived from
  anything attacker-controllable.
- The **Grove tab is a first-party child webview** (Tauri v2 multi-webview), not an
  `<iframe>`. This matters: an iframe would make Supabase's auth cookies third-party and
  subject to SameSite/partitioning breakage inside the webview; a top-level child webview is
  first-party to `nibbin.com`, so cookies behave normally. (Mechanism risk noted below.)

## Components

### Shell frontend (`apps/desktop/src`, Vite/TS — existing stack)
- **Login view** (new): branded email/password form; uses `@supabase/supabase-js`
  (`signInWithPassword`); inline error states; on success calls a Tauri command to persist
  the session, then transitions to the shell.
- **Tab bar + router** (new): two tabs; switching shows/hides the Grove child webview vs the
  native Field Study views.
- **Field Study views** (existing `ui/views/{consent,study,review,notes}.ts`): rehosted under
  the Field Study tab; `study` view + strings renamed to "field study"; a **Start a field
  study** affordance added (runs the existing consent → start path).
- Removed from the shell: the standalone `account` sign-in view (auth is now the global gate).

### Rust (`apps/desktop/src-tauri/app/src`)
- **`auth.rs`**: keep keychain storage + `auth_session()` (silent refresh, sign-out-everywhere
  drop). Add `store_session(session_json)` command for the in-app login. Remove `auth_start`,
  `complete_from_url`, and the `nibbin://auth` deep-link handler (the PKCE redirect path).
- **`lib.rs`**: create/position/show/hide the Grove child webview; keep the tray (background
  field-study state only); keep the C6 pause hotkey but make registration **non-fatal**
  (log on failure instead of `?`, so a hotkey conflict can't crash startup).
- **`tauri.conf.json`**: `productName` → "Nibbin"; window `title` → "Nibbin"; window
  `visible` → `true`; tray tooltip → "Nibbin"; CSP `connect-src`/child-webview navigation
  allowed for `https://nibbin.com` + Supabase.

### Web app (`apps/web`) — one new route
- **`/desktop-auth`** (client component): read `access_token` + `refresh_token` from
  `location.hash`, call the browser Supabase client's `setSession(...)`, clear the hash, then
  `router.replace('/app')`. Idempotent and a no-op when no tokens are present. This is the
  only web change; all other web screens are reused unchanged.

## Auth & session flow (detailed)

1. **Launch** → Rust `auth_session()` checks the keychain. If a valid (or refreshable) session
   exists → Shell; otherwise → Login gate.
2. **Login** → user submits email/password → `supabase.auth.signInWithPassword` →
   session object → `invoke('store_session', …)` writes it to the keychain → transition to Shell.
3. **Grove handoff** → the Grove child webview navigates to
   `${WEB_URL}/desktop-auth#access_token=…&refresh_token=…`. The web route calls
   `setSession`, which sets the Supabase SSR cookies *in that webview*, clears the fragment,
   and redirects to `/app`. The product renders fully authenticated.
4. **Logout** → clear the keychain (existing `sign_out`), clear the Grove webview session,
   return to the Login gate.

**Security:** tokens travel only in the URL **fragment** (never sent to any server / not
logged); transport is HTTPS to a pinned origin; the session at rest lives in the OS keychain
(never on disk, never in the SQLCipher study DB). The web side keeps its server-side RLS +
server-only secrets — embedding changes none of that.

## Data flow

- **Grove:** webview ⇄ `nibbin.com` (Server Components / Server Actions / RLS, exactly as on
  web — no change to the web data layer).
- **Field Study:** native UI ⇄ `observerd` daemon (local capture, SQLCipher), as today.
- **Session:** keychain (native, source of truth) → Grove webview cookies (via the handoff).

## Error handling

- **Bad credentials / network at login:** inline, human-readable error; no tab access.
- **Expired session at launch:** `auth_session()` attempts silent refresh; on failure → gate.
- **Grove webview can't reach `nibbin.com`:** native "Can't reach Nibbin — Retry" state in the
  Grove tab. Field Study still works fully offline.
- **Handoff failure** (`/desktop-auth` errors): fall back to the web login rendered in the
  Grove webview, so the user can still get in.

## Testing

- **Rust unit:** session store/read/refresh round-trip; `store_session` validation.
- **Web unit:** `/desktop-auth` token parsing + `setSession` call + redirect; no-op when hash
  empty.
- **Frontend:** login form validation + error rendering; auth-state → which view renders.
- **Manual / on-device (Windows + macOS):** launch → gate → login → Grove authenticated; tab
  switch; Start a field study; logout → gate; offline Grove degradation. (Webview embedding +
  keychain are not cleanly E2E-testable in CI; verify on device.)

## Phasing

- **Phase 1 (this spec):** login gate, keychain session, tabbed shell, Grove embed + handoff,
  Field Study rehost + start flow + rename, app rename, opens visible, remove PKCE redirect.
- **Phase 2:** Field Study cloud upload using the native session; desktop-awareness tweaks to
  the embedded UI (suppress redundant web chrome, native-feel polish).
- **Phase 3:** full-bleed icon; modern NSIS installer with Nibbin branding.

## Risks / open questions

- **Tauri v2 multi-webview is an `unstable` feature.** Validate it gives a clean tab-embedded
  webview positioned under the native tab bar. Fallbacks, in order of preference: a separate
  `WebviewWindow`; last resort an `<iframe>` (accepting the cookie/SameSite risk + a
  `frame-ancestors` allowance on the web app).
- **Cookie persistence:** confirm `setSession` cookies survive subsequent navigations inside
  the Tauri webview (vs. being treated as session-only/ephemeral).
- **`/app` unauthenticated redirect:** the web app likely bounces `/app` → login when no
  session; the handoff at `/desktop-auth` must complete `setSession` *before* `/app` loads.
  Sequence via the route's redirect, not a parallel navigation.
- **CSP:** `tauri.conf.json` CSP and any webview navigation policy must permit `nibbin.com`
  and Supabase.
- **Retiring the PKCE bridge:** remove `auth_start` / `complete_from_url` / the deep-link
  handler and the `/api/auth/desktop/{issue,token}` routes. The `desktop_auth_codes` table
  can remain (harmless) and be dropped in a later migration.
