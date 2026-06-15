# Nibbin Desktop Unified App — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the desktop app from the standalone Observer into the Nibbin app: a native login gate → a tabbed shell with **Grove** (the embedded web product) and **Field Study** (the native Observer), renamed throughout.

**Architecture:** Keep the existing vanilla-TS Tauri frontend. Add an auth gate that renders a native Supabase email/password login until a keychain session exists, then a two-tab shell. Grove is a first-party child webview pointed at `nibbin.com`, signed in via a `/desktop-auth` handoff route; Field Study is the existing native views. The web app's server-side data/security model is unchanged.

**Tech Stack:** Tauri v2 (Rust), TypeScript + Vite (no framework), `@supabase/supabase-js`, Next.js (web route only).

Spec: `docs/superpowers/specs/2026-06-15-nibbin-desktop-unified-app-design.md`

**Testing note:** The desktop frontend has no view-unit-test harness today (matching its framework-free style), so DOM/webview wiring is verified by `tsc` typecheck + `cargo build` + on-device manual checks. Genuinely testable logic — Rust session commands and the `/desktop-auth` token parsing — gets real unit tests (TDD). Don't add a view-test framework; follow the existing pattern.

**Per-task commits:** every task ends in a commit. Run `npm --prefix apps/desktop run typecheck` (alias for `tsc --noEmit`) before committing frontend changes.

---

## File Structure (what changes)

- `apps/desktop/src-tauri/app/tauri.conf.json` — productName/title/visible/tooltip; CSP.
- `apps/desktop/index.html` — `<title>`.
- `apps/desktop/src/ui/main.ts` — auth gate + two-tab shell (largest change).
- `apps/desktop/src/ui/bridge.ts` — add `storeSession`; drop `authStart`.
- `apps/desktop/src/ui/views/login.ts` — **new** native login view.
- `apps/desktop/src/ui/views/grove.ts` — **new** Grove tab (manages the child webview).
- `apps/desktop/src/ui/views/field-study.ts` — **new** wrapper that hosts the existing study/review/notes/preferences sub-views with a "Start a field study" entry.
- `apps/desktop/src/ui/views/{study,consent,review,notes,preferences}.ts` — "study" → "field study" strings; delete `account.ts`.
- `apps/desktop/src-tauri/app/src/auth.rs` — add `store_session`; remove `auth_start`/`complete_from_url`.
- `apps/desktop/src-tauri/app/src/lib.rs` — register `store_session`; drop `auth_start`/deep-link auth; non-fatal hotkey; Grove webview creation.
- `apps/desktop/package.json` — add `@supabase/supabase-js`.
- `apps/web/app/desktop-auth/page.tsx` — **new** session-handoff route.
- `apps/web/app/api/auth/desktop/{issue,token}/route.ts` — delete (retire PKCE bridge).

---

# STAGE A — Shell restructure, rename, Field Study tab

Produces: app named **Nibbin**, opens visible, top tabs **Grove** (placeholder for now) | **Field Study**; Field Study hosts the existing views minus Account; all "study" → "field study"; a "Start a field study" entry. No auth/embed yet.

### Task A1: Rename the app + open visible

**Files:**
- Modify: `apps/desktop/src-tauri/app/tauri.conf.json`
- Modify: `apps/desktop/index.html`

- [ ] **Step 1: Edit `tauri.conf.json`** — set these four values:
  - `"productName": "Nibbin Observer"` → `"productName": "Nibbin"`
  - window `"title": "Nibbin Observer"` → `"title": "Nibbin"`
  - window `"visible": false` → `"visible": true`
  - trayIcon `"tooltip": "Nibbin Observer"` → `"tooltip": "Nibbin"`

- [ ] **Step 2: Edit `index.html`** — `<title>Nibbin Observer</title>` → `<title>Nibbin</title>`

- [ ] **Step 3: Commit**
```bash
git add apps/desktop/src-tauri/app/tauri.conf.json apps/desktop/index.html
git commit -m "feat(desktop): rename app to Nibbin; open window visible"
```

### Task A2: Make the pause-hotkey registration non-fatal

**Files:**
- Modify: `apps/desktop/src-tauri/app/src/lib.rs` (the `app.global_shortcut().register(PAUSE_SHORTCUT)?;` line in `setup`)

- [ ] **Step 1: Replace the fatal `?` with a logged warning** so a hotkey conflict can't crash startup:
```rust
            if let Err(e) = app.global_shortcut().register(PAUSE_SHORTCUT) {
                eprintln!("pause hotkey unavailable (continuing without it): {e}");
            }
```
- [ ] **Step 2: Build** — `cargo build --manifest-path apps/desktop/src-tauri/app/Cargo.toml` → Expected: compiles. (If Rust isn't installed locally, rely on CI; note it.)
- [ ] **Step 3: Commit**
```bash
git add apps/desktop/src-tauri/app/src/lib.rs
git commit -m "fix(desktop): pause-hotkey registration is non-fatal on startup"
```

### Task A3: Rename "study" → "field study" in the views

**Files:**
- Modify: `apps/desktop/src/ui/views/study.ts`, `consent.ts`, `review.ts`, `notes.ts`
- Modify: `apps/desktop/src-tauri/app/src/lib.rs` (tray strings)

- [ ] **Step 1: Update user-facing strings.** In the view files, change visible copy: "the study" → "the field study", "Study complete" → "Field study complete", "study ended" → "field study ended", tab label "Study" → "Field study". Keep internal identifiers/daemon state names (e.g. `study_status`, `StudyStatus`, daemon `state` values) unchanged — only UI text.
- [ ] **Step 2: Update tray strings in `lib.rs`** — tray menu `"Open Observer"` → `"Open Nibbin"`; tooltip format `"Nibbin Observer — field study: {days}d {hours}h left"` → `"Nibbin — field study: {days}d {hours}h left"`.
- [ ] **Step 3: Typecheck** — `npm --prefix apps/desktop run typecheck` → Expected: passes.
- [ ] **Step 4: Commit**
```bash
git add apps/desktop/src apps/desktop/src-tauri/app/src/lib.rs
git commit -m "feat(desktop): rename 'study' to 'field study' in UI + tray"
```

### Task A4: Extract a Field Study view wrapper with a "Start a field study" entry

**Files:**
- Create: `apps/desktop/src/ui/views/field-study.ts`
- Delete: `apps/desktop/src/ui/views/account.ts`

This moves the field-study sub-navigation (the daemon-state dispatch + review/notes/preferences) out of `main.ts` into one focused view, and adds an explicit start affordance for the `NOT_STARTED`/`CONSENTED` states.

- [ ] **Step 1: Create `field-study.ts`** exporting `fieldStudyView(rerender)`. Move `reviewStateView` and the state-dispatch (`switch (status.state)`) out of `main.ts` into here, plus a sub-nav (Field study / Review / Field notes / Preferences). For the `NOT_STARTED`/`CONSENTED` states, render the existing `consentView`, but ensure the consent flow's primary button reads **"Start a field study"** and calls `bridge.sendControl('start')` (verify the daemon's start command name in `consent.ts`; reuse whatever it already uses) before `consentView` renders the active study.

```ts
import { bridge, type StudyStatus } from '../bridge.js';
import { button, el } from '../dom.js';
import { consentView } from './consent.js';
import { notesView } from './notes.js';
import { preferencesView } from './preferences.js';
import { reviewView } from './review.js';
import { deleteEverythingCard, studyView } from './study.js';

type Sub = 'home' | 'review' | 'notes' | 'preferences';

export function fieldStudyView(rerender: () => void): HTMLElement {
  const root = el('div', {});
  let sub: Sub = 'home';
  const mount = el('div', {});

  async function paint(): Promise<void> {
    const status = await bridge.studyStatus();
    const { children } = mount; void children;
    mount.replaceChildren();
    if (sub === 'review') return void mount.append(reviewView());
    if (sub === 'notes') return void mount.append(notesView());
    if (sub === 'preferences') return void mount.append(preferencesView(() => void paint()));
    // sub === 'home' → daemon-state dispatch
    switch (status.state) {
      case 'NOT_STARTED':
      case 'CONSENTED':
        mount.append(consentView(() => void paint()));
        break;
      case 'ACTIVE':
      case 'PAUSED':
        mount.append(studyView(status, () => void paint()));
        break;
      default:
        mount.append(stateView(status, () => void paint()));
    }
  }

  const nav = el('nav', { class: 'subnav' });
  const subs: [Sub, string][] = [
    ['home', 'Field study'],
    ['review', 'Review'],
    ['notes', 'Field notes'],
    ['preferences', 'Preferences'],
  ];
  for (const [key, label] of subs) {
    nav.append(button(label, () => { sub = key; void paint(); }));
  }
  root.append(nav, mount);
  void paint();
  return root;
}
```
(Move the former `reviewStateView` into this file renamed `stateView(status, rerender)`; it is unchanged except the rename. Delete `account.ts` — account/auth now lives behind the global gate + Grove.)

- [ ] **Step 2: Typecheck** — `npm --prefix apps/desktop run typecheck` (will FAIL until `main.ts` is updated in A5; that's fine — do A5 then typecheck).
- [ ] **Step 3: Commit** (after A5 typecheck passes — A4+A5 land together):
```bash
git add apps/desktop/src/ui/views/field-study.ts
git rm apps/desktop/src/ui/views/account.ts
git commit -m "feat(desktop): Field Study view wrapper + Start-a-field-study entry"
```

### Task A5: Rebuild `main.ts` as a two-tab shell (Grove placeholder | Field Study)

**Files:**
- Modify: `apps/desktop/src/ui/main.ts`
- Create: `apps/desktop/src/ui/views/grove.ts` (interim Grove view in Stage A; Stage C wires the embedded web product into this same view)

- [ ] **Step 1: Create the `grove.ts` interim view** — the tab is **Grove** from day one (capitalized, branded); Stage C swaps the body for the embedded child webview without renaming anything:
```ts
import { el } from '../dom.js';
// Stage C replaces the body with the embedded web child-webview — the tab stays "Grove".
export function groveView(): HTMLElement {
  return el('div', { class: 'grove-tab' }, [
    el('h1', {}, ['Grove']),
    el('p', { class: 'muted' }, ['Connecting your grove…']),
  ]);
}
```

- [ ] **Step 2: Replace `main.ts` body** with a two-tab shell:
```ts
import '@nibbin/shared/tokens.css';
import './observer.css';
import { bridge } from './bridge.js';
import { button, clear, el } from './dom.js';
import { fieldStudyView } from './views/field-study.js';
import { groveView } from './views/grove.js';

type Tab = 'grove' | 'field-study';
const app = document.getElementById('app')!;
let tab: Tab = 'grove';

function render(): void {
  clear(app);
  const nav = el('nav', { class: 'nav tabbar' });
  const tabs: [Tab, string][] = [['grove', 'Grove'], ['field-study', 'Field Study']];
  for (const [key, label] of tabs) {
    const b = button(label, () => { tab = key; render(); });
    if (key === tab) b.setAttribute('aria-current', 'true');
    nav.append(b);
  }
  app.append(nav);
  app.append(tab === 'grove' ? groveView() : fieldStudyView(render));
}

render();
void bridge.onEvent('study:paused-by-hotkey', () => render());
```
- [ ] **Step 3: Typecheck** — `npm --prefix apps/desktop run typecheck` → Expected: passes (A4 + A5 together).
- [ ] **Step 4: Commit** (the A4 commit above covers `field-study.ts`/`account.ts`; commit `main.ts` + `grove.ts` here):
```bash
git add apps/desktop/src/ui/main.ts apps/desktop/src/ui/views/grove.ts
git commit -m "feat(desktop): two-tab shell — Grove | Field Study"
```

**Stage A done:** build the app (or push to trigger `desktop-release`) and verify on device: opens visible, titled Nibbin, two tabs, Field Study works, "field study" wording, Start entry appears in the NOT_STARTED state.

---

# STAGE B — Native login gate + keychain session

Produces: the app shows a native Nibbin email/password screen until a keychain session exists; on success it stores the session and shows the shell. Removes the PKCE redirect bridge.

### Task B1: Add `@supabase/supabase-js` to the desktop app

**Files:** Modify `apps/desktop/package.json`

- [ ] **Step 1:** add to `dependencies`: `"@supabase/supabase-js": "^2.58.0"` (match the version already in the root lockfile — check `apps/web/package.json` and use the same).
- [ ] **Step 2:** `npm install` (root) → Expected: resolves, workspace symlink created.
- [ ] **Step 3: Commit**
```bash
git add apps/desktop/package.json package-lock.json
git commit -m "build(desktop): add @supabase/supabase-js"
```

### Task B2: `store_session` Rust command (TDD)

**Files:**
- Modify: `apps/desktop/src-tauri/app/src/auth.rs`
- Modify: `apps/desktop/src-tauri/app/src/lib.rs` (register command; remove `auth_start`)

- [ ] **Step 1: Write the failing test** in `auth.rs` (`#[cfg(test)]`): persisting a session JSON then reading it back via the same keychain entry yields the stored value. (Keychain isn't available on CI Linux; gate the test `#[cfg(target_os = "windows")]`/`macos` or use a thin in-memory seam. Simplest: extract the (de)serialization into a pure helper `parse_session(&str) -> Result<Value>` and test THAT.)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_session_roundtrips() {
        let v = serde_json::json!({"access_token":"a","refresh_token":"r","expires_at":123});
        let s = v.to_string();
        assert_eq!(parse_session(&s).unwrap(), v);
    }
    #[test]
    fn parse_session_rejects_garbage() {
        assert!(parse_session("not json").is_err());
    }
}
```
- [ ] **Step 2: Run** `cargo test --manifest-path apps/desktop/src-tauri/app/Cargo.toml parse_session` → Expected: FAIL (no `parse_session`).
- [ ] **Step 3: Implement** the helper + command:
```rust
fn parse_session(s: &str) -> Result<serde_json::Value, anyhow::Error> {
    Ok(serde_json::from_str(s)?)
}

/// Persist a Supabase session obtained from the in-app login into the keychain.
#[tauri::command]
pub fn store_session(session: serde_json::Value) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION)
        .and_then(|e| e.set_password(&session.to_string()))
        .map_err(|e| e.to_string())
}
```
- [ ] **Step 4: Run** the test → Expected: PASS.
- [ ] **Step 5: Remove the PKCE redirect path** — delete `auth_start`, `auth_start_inner`, `complete_from_url`, `PendingSignIn`/`PENDING`, and the now-unused imports in `auth.rs`. In `lib.rs` remove `auth::auth_start` from the handler list, add `auth::store_session`, and delete the `deep_link().on_open_url(...)` auth block (keep `auth_session` + `sign_out`). Keep the `tauri_plugin_deep_link` plugin registration only if used elsewhere; otherwise remove it too.
- [ ] **Step 6: Build** → `cargo build --manifest-path apps/desktop/src-tauri/app/Cargo.toml` → Expected: compiles (no references to removed items).
- [ ] **Step 7: Commit**
```bash
git add apps/desktop/src-tauri/app/src/auth.rs apps/desktop/src-tauri/app/src/lib.rs
git commit -m "feat(desktop): store_session command; remove PKCE redirect bridge"
```

### Task B3: Bridge — add `storeSession`, drop `authStart`

**Files:** Modify `apps/desktop/src/ui/bridge.ts`

- [ ] **Step 1:** remove the `authStart` entry; add:
```ts
  storeSession: (session: Record<string, unknown>) =>
    call<void>('store_session', { session }, undefined),
```
- [ ] **Step 2: Typecheck** (will pass once B4 removes the only `authStart` caller — it was in `account.ts`, already deleted in A4, so this should pass now).
- [ ] **Step 3: Commit**
```bash
git add apps/desktop/src/ui/bridge.ts
git commit -m "feat(desktop): bridge.storeSession; drop authStart"
```

### Task B4: Native login view + auth gate in `main.ts`

**Files:**
- Create: `apps/desktop/src/ui/views/login.ts`
- Create: `apps/desktop/src/ui/supabase.ts` (browser client singleton)
- Modify: `apps/desktop/src/ui/main.ts`

- [ ] **Step 1: Create `supabase.ts`** — a browser Supabase client pinned to env (Vite `import.meta.env`, with a hardcoded prod fallback matching `auth.rs`):
```ts
import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://oqnqzytctwlptfdvyagl.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
export const supabase = createClient(url, key, { auth: { persistSession: false } });
```
(persistSession:false — the keychain is the store of record, not webview localStorage.)

- [ ] **Step 2: Create `login.ts`** — branded email/password form; on submit calls `signInWithPassword`, stores the session via the bridge, then calls `onSignedIn()`:
```ts
import { supabase } from '../supabase.js';
import { bridge } from '../bridge.js';
import { button, el } from '../dom.js';

export function loginView(onSignedIn: () => void): HTMLElement {
  const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' });
  const pass = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const err = el('p', { class: 'error', role: 'alert' });
  const submit = button('Sign in', () => void go(), 'primary');

  async function go(): Promise<void> {
    err.textContent = '';
    submit.setAttribute('disabled', 'true');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: (email as HTMLInputElement).value.trim(),
      password: (pass as HTMLInputElement).value,
    });
    submit.removeAttribute('disabled');
    if (error || !data.session) { err.textContent = error?.message ?? 'Sign-in failed.'; return; }
    await bridge.storeSession(data.session as unknown as Record<string, unknown>);
    onSignedIn();
  }

  return el('div', { class: 'login-gate' }, [
    el('h1', {}, ['Nibbin']),
    el('p', { class: 'muted' }, ['Sign in to your grove.']),
    el('label', {}, ['Email', email]),
    el('label', {}, ['Password', pass]),
    err, submit,
  ]);
}
```
- [ ] **Step 3: Gate the shell in `main.ts`** — check `bridge.authSession()` on load; render `loginView` until signed in, then the shell:
```ts
async function boot(): Promise<void> {
  const session = await bridge.authSession();
  if (!session) { clear(app); app.append(loginView(() => void boot())); return; }
  render(); // existing two-tab shell
}
boot();
```
(Replace the bare `render()` call at the bottom of `main.ts` with `boot()`. Import `loginView`.)
- [ ] **Step 4: Typecheck** — `npm --prefix apps/desktop run typecheck` → Expected: passes.
- [ ] **Step 5: Commit**
```bash
git add apps/desktop/src/ui/views/login.ts apps/desktop/src/ui/supabase.ts apps/desktop/src/ui/main.ts
git commit -m "feat(desktop): native login gate (Supabase email/password) → keychain"
```

**Stage B done:** on device — launch shows the login screen; valid creds → shell; relaunch stays signed in (keychain); Sign out (Field Study → Preferences, or add a shell control) returns to the gate.

---

# STAGE C — Grove embed + `/desktop-auth` handoff

Produces: the Grove tab shows the authenticated web product via a first-party child webview.

### Task C1: `/desktop-auth` web route (TDD on the parser)

**Files:**
- Create: `apps/web/app/desktop-auth/page.tsx`
- Create: `apps/web/lib/desktop-auth/parse-tokens.ts` + test

- [ ] **Step 1: Write the failing test** `apps/web/lib/desktop-auth/parse-tokens.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTokens } from './parse-tokens';
describe('parseTokens', () => {
  it('extracts tokens from a fragment', () => {
    expect(parseTokens('#access_token=a&refresh_token=r')).toEqual({ access_token: 'a', refresh_token: 'r' });
  });
  it('returns null when missing', () => {
    expect(parseTokens('#access_token=a')).toBeNull();
    expect(parseTokens('')).toBeNull();
  });
});
```
- [ ] **Step 2: Run** `npm --prefix apps/web exec vitest run lib/desktop-auth/parse-tokens.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implement** `parse-tokens.ts`:
```ts
export function parseTokens(hash: string): { access_token: string; refresh_token: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = p.get('access_token'); const refresh_token = p.get('refresh_token');
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}
```
- [ ] **Step 4: Run** the test → Expected: PASS.
- [ ] **Step 5: Create the page** `apps/web/app/desktop-auth/page.tsx` (client component) using the existing browser Supabase client (`apps/web/lib/supabase/client.ts`):
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { parseTokens } from '@/lib/desktop-auth/parse-tokens';

export default function DesktopAuth() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const tokens = parseTokens(window.location.hash);
    if (!tokens) { router.replace('/login'); return; }
    history.replaceState(null, '', '/desktop-auth'); // strip tokens from the URL
    createClient().auth.setSession(tokens)
      .then(({ error }) => error ? setErr(error.message) : router.replace('/app'))
      .catch((e) => setErr(String(e)));
  }, [router]);
  return <main style={{ padding: 24 }}>{err ? `Sign-in failed: ${err}` : 'Signing you in…'}</main>;
}
```
(Verify the import path/symbol for the browser client in `apps/web/lib/supabase/client.ts` and the unauthenticated login route — adjust `/login` if the web app uses a different path.)
- [ ] **Step 6: Commit**
```bash
git add apps/web/app/desktop-auth apps/web/lib/desktop-auth
git commit -m "feat(web): /desktop-auth session-handoff route for the desktop Grove embed"
```

### Task C2: VALIDATE the child-webview mechanism (spike — do this before C3)

Tauri v2 multi-webview is behind the `unstable` feature; confirm it works before building the real Grove tab.

- [ ] **Step 1:** add `tauri = { version = "2", features = ["tray-icon", "unstable"] }` in `apps/desktop/src-tauri/app/Cargo.toml`.
- [ ] **Step 2:** in `lib.rs` `setup`, add a throwaway command/spike that creates a child `WebviewBuilder` in the main window pointed at `https://example.com`, positioned below a 48px top strip, and logs success/failure:
```rust
use tauri::{webview::WebviewBuilder, LogicalPosition, LogicalSize, WebviewUrl};
// inside setup, after window exists:
if let Some(win) = app.get_window("main") {
    let size = win.inner_size()?;
    let _ = win.add_child(
        WebviewBuilder::new("grove", WebviewUrl::External("https://example.com".parse().unwrap())),
        LogicalPosition::new(0.0, 48.0),
        LogicalSize::new(size.width as f64, size.height as f64 - 48.0),
    ).map_err(|e| eprintln!("multiwebview spike failed: {e}"));
}
```
- [ ] **Step 3:** build + run on device → Expected: example.com renders below the strip.
- [ ] **Step 4 (decision gate):** If it works → proceed to C3 using this API. **If it fails or is unstable on Windows**, fall back to: a separate `WebviewWindow` for Grove toggled with the main window (documented fallback), or last-resort an `<iframe>` in `grove.ts` with a `frame-ancestors https://tauri.localhost` allowance added to the web app's CSP. Record the chosen mechanism in the spec's Risks section.
- [ ] **Step 5:** revert the spike (`git stash`/discard) — C3 implements the real version. No commit.

### Task C3: Grove tab drives the child webview with the session handoff

**Files:**
- Modify: `apps/desktop/src-tauri/app/src/lib.rs` (commands to show/hide/navigate the Grove webview)
- Modify: `apps/desktop/src/ui/views/grove.ts` (replace placeholder)
- Modify: `apps/desktop/src/ui/bridge.ts` (`groveShow`/`groveHide`)

Implement using the mechanism validated in C2. The desktop, when the Grove tab activates, ensures a child webview exists at `${WEB_URL}/desktop-auth#access_token=…&refresh_token=…` (tokens read from the keychain session via a new `grove_url()` command that returns the handoff URL), shows it, and hides it on tab switch. Pin `WEB_URL` via `option_env!("NIBBIN_WEB_URL").unwrap_or("https://nibbin.com")` (same pattern as the old `auth.rs`).

- [ ] **Step 1:** add Rust commands: `grove_show()` (create-if-absent + show, navigating to the handoff URL built from the keychain session's `access_token`/`refresh_token`), `grove_hide()`, registered in `lib.rs`. Add `frame`/position handling consistent with C2's result.
- [ ] **Step 2:** `bridge.ts` — add `groveShow`/`groveHide` calling those commands.
- [ ] **Step 3:** `grove.ts` — replace the placeholder so mounting it calls `bridge.groveShow()` and unmounting (tab switch) calls `bridge.groveHide()`. Show a native "Can't reach Nibbin — Retry" fallback element behind the webview for offline.
- [ ] **Step 4:** `main.ts` — when switching tabs, call `bridge.groveHide()` on leaving Grove (wire into the tab click).
- [ ] **Step 5: CSP** — in `tauri.conf.json`, ensure the app CSP allows the child webview to load `https://nibbin.com` and connect to Supabase (`connect-src`/`frame-src` as the mechanism requires).
- [ ] **Step 6: Typecheck + build** → Expected: pass.
- [ ] **Step 7: On-device verify** — Grove tab shows the authenticated `/app`; switching to Field Study hides it; relaunch keeps you signed in; offline shows the retry state.
- [ ] **Step 8: Commit**
```bash
git add apps/desktop/src apps/desktop/src-tauri/app
git commit -m "feat(desktop): Grove tab embeds authenticated web product via session handoff"
```

### Task C4: Retire the dead web auth-bridge routes

**Files:** Delete `apps/web/app/api/auth/desktop/issue/route.ts` + `.../token/route.ts`

- [ ] **Step 1:** `git rm` both route files. (Leave the `desktop_auth_codes` table/migration in place — harmless; drop in a later migration.)
- [ ] **Step 2:** grep for references (`grep -rn "auth/desktop/" apps`) → Expected: none remain.
- [ ] **Step 3: Commit**
```bash
git rm apps/web/app/api/auth/desktop/issue/route.ts apps/web/app/api/auth/desktop/token/route.ts
git commit -m "chore(web): remove retired desktop PKCE auth-bridge routes"
```

---

## Final verification (whole Phase 1)

- [ ] Push the branch; let `desktop-release` build (Windows `.msi` + signed macOS `.dmg`). Install on device.
- [ ] Launch → native **Nibbin** login → sign in → **Grove** shows your authenticated grove; **Field Study** tab works and can start a field study; relaunch stays signed in; sign out returns to the gate.
- [ ] `grep -rn "Observer" apps/desktop/src apps/desktop/index.html` → only intentional internal references remain (no stray user-facing "Observer").

---

## Self-Review

**Spec coverage:** rename→A1; opens visible→A1; "study"→"field study"→A3; Start-a-field-study→A4; tabs Grove|Field Study→A5; native login gate + keychain→B2/B4; remove PKCE bridge→B2/C4; Grove embed + handoff→C1/C2/C3; `/desktop-auth` route→C1; pinned WEB_URL→C3; CSP→C3; non-fatal hotkey→A2. Deferred (Phase 2/3) correctly absent. ✔

**Placeholder scan:** the only "figure it out" points are deliberate verify-then-adjust notes (daemon start-command name in A4; web login path + browser-client symbol in C1; webview mechanism in C2) — each names the exact file to confirm against and a concrete default. C2 is an explicit spike with candidate code + ordered fallbacks, not a placeholder. ✔

**Type consistency:** `bridge.storeSession`(B3) ↔ `store_session`(B2) ↔ `login.ts` call(B4); `groveShow/groveHide`(bridge) ↔ `grove_show/grove_hide`(Rust) in C3; `parseTokens`(C1) used by the page in the same task. ✔
