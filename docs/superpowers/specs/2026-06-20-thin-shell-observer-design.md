# Thin-Shell Observer — Design

**Date:** 2026-06-20
**Status:** Design (approved in brainstorming; pending spec review → implementation plan)

## Goal

Make the desktop app's UI/UX **100% the web app**. The desktop becomes a thin native shell whose only native responsibilities are local capture and the OS glue a browser sandbox can't do. The separately-built native Field Study UI — which looks bare and disconnected from the polished web app — is deleted and rebuilt once, as web routes.

## Problem (evidenced)

Screenshots of the current desktop app (2026-06-19):
- **Grove tab** renders the full embedded web app, but a **native top tab bar (`Grove | Field Study`) sits on top of it** — doubled, clashing chrome (the web app already has its own sidebar nav).
- **Field Study / Review / Field notes / Preferences** are native screens: bare cards, awkward pill placement (the "Watching" pill floats mid-card; "Observer · *1 moments*"), empty inputs, oceans of whitespace. Preferences even says "go to nibbin.com for account settings" — the web/desktop split made visible.

Root cause: two UIs. The web app is the loved one; the native Field Study UI is a second, less-maintained implementation that drifts.

## Non-negotiable constraint

Capture **must** stay native and local — it reads the screen + other apps' accessibility tree, which a browser tab physically cannot do, and nothing leaves the device until the user approves a packet. This is the privacy moat, not a limitation to remove. So "run everything from the web" is impossible for capture; everything *around* capture can and should be the web app.

## Architecture (Option A — "thin shell")

Three layers:

1. **Web UI (the whole product).** The desktop renders `nibbin.com/app` in its webview — same nav, same routes, same design system. No native screens.
2. **`observerd` (native, local).** Unchanged. Local capture; daemon-side privacy enforcement (C2 14-day stop, C3/C4/C5).
3. **Native glue + bridge.** The smallest possible native surface: tray + exit cleanup, global pause hotkey (C6), OS permission prompts, daemon spawn + single-instance, the auth/session handoff, and a **local IPC bridge** the embedded web UI calls.

### Single navigation (resolves the doubled chrome)

The native top tab bar is **removed**. The desktop shows the full web app with its one sidebar nav. Field Study becomes nav items/routes in that sidebar, live only inside the shell.

### Grove-home card swap (the entry point)

The existing `HideInDesktop` pattern is inverted into a *swap*: the "Get the desktop app" card (browser) becomes a live **Field study** status card (desktop) — countdown / "Watching" / quick pause — linking into the full Field Study route. Same slot, environment-swapped.

## Bridge protocol & security boundary

The bridge **already exists** — today's native UI uses `bridge.ts` (`studyStatus`, `reviewEvents`, `sendControl`, `accessToken`, `authSession`, `onEvent`, `groveShow/Hide`). Option A re-points that same contract from the native UI to the embedded web routes and fills the gaps the new routes need.

**Surface (scoped, explicit — nothing more):**
- *Queries:* `studyStatus()`, `reviewData()` (already-redacted kept events), `fieldNotes()` (derived local notes), `exclusions()`, `captureHealth()`.
- *Commands:* `startStudy(opts)`, `pause()`/`resume()`, `stopEarly()`, `addExclusion()`/`removeExclusion()`, `buildPacket()`+`uploadPacket()` (the existing review-before-upload gate, unchanged), `deleteEverything()`.
- *Events:* `onStudyStateChange`, `onCaptureHealth`.
- *Probe:* `isShell()` / `bridgeVersion()` — web routes detect the shell and version-negotiate; in a browser the probe is absent → routes render the download gate.

**Security boundary (the crux):**
1. **Origin-locked.** The Tauri IPC capability is granted **only** to the bundled `nibbin.com` origin, and the webview navigation is allowlisted to that origin. Arbitrary/navigated content can never reach these privileged methods (they control local capture and can delete local data).
2. **No new egress.** `reviewData()`/`fieldNotes()` return only the **already-redacted, derived** data the native Review screen shows today — raw capture never crosses the bridge. Upload stays behind the existing packet-review gate. Local-only is unchanged.
3. **Daemon stays the enforcer.** C2/C3/C4/C5 remain daemon-side. The bridge is display + control, never the authority.

## Field Study web routes

Built once in the web app, on the real design system, bridge-driven, `isShell()`-gated:
- `/app/study` — live/in-progress (countdown, "Watching", capture health, pause/stop).
- `/app/study/review` — "what the field study kept" (already-redacted), per-item + per-app delete, exclusions.
- `/app/study/notes` — today's field notes (derived, local).
- `/app/study/preferences` — exclusions, capture depth (Lite/Detailed), delete-everything.

In a browser these show a "this runs in the desktop app" gate. Account settings are simply the existing web settings — no "go to the website" hand-off.

## Cutover (one-go, no phases)

Per decision: single cutover, accept weekend breakage (only the owner + friends use it today).

One branch:
1. Builds the Field Study web routes (bridge-driven, shell-gated).
2. Exposes the bridge to the embedded `nibbin.com` origin (origin-locked IPC + navigation allowlist).
3. Deletes the native Field Study UI and the doubled tab bar (`views/field-study.ts`, `views/consent.ts`, `views/study.ts`, `views/field-study-state.ts`, the sub-tab nav, the Grove/Field-Study tab switching in `main.ts`).
4. Flips the desktop to render the full web app (one nav) + the Grove-home card swap.

Then: merge → web auto-deploys; cut desktop **`0.2.3`** with the bridge + native UI gone. (Two artifacts is mechanical — web is instant, desktop is a signed release — not a phased rollout.)

### Deleted vs. kept

- **Deleted:** native Field Study/Review/Field-notes/Preferences UI, the native top tab bar, the dual-tab logic in `main.ts`, the per-second poll re-render (source of the 1s "shutter" — gone with the UI).
- **Kept (native):** `observerd`, `bridge.ts` (re-targeted to the web origin), tray/hotkey/permissions/spawn/single-instance, the auth/session handoff.

## Privacy invariants preserved

- Capture local-only until user-approved packet upload (C7) — unchanged.
- 14-day wall-clock stop + anti-rollback (C2) — daemon-enforced, unchanged.
- Bridge is origin-locked; exposes only already-redacted/derived data; adds no egress path.
- Pause "near-instantly"; secure-fields by construction — daemon-side, unchanged.

## Risks / open questions

- **Tauri 2 IPC to a remote origin.** Exposing scoped IPC to `nibbin.com` (a remote URL, not the local frontend) needs the Tauri capability/permission config to allowlist that origin for exactly the bridge commands. This is the riskiest unknown; the plan must validate it early (it's also the security crux).
- **Offline / web-unreachable.** If the shell can't load `nibbin.com`, the user has no UI. Need a minimal native fallback screen ("can't reach Nibbin — capture continues; retry") so capture/daemon aren't orphaned.
- **Latency of bridge round-trips** for live status — keep the in-progress route on a sane refresh (event-driven via `onStudyStateChange`, not a tight poll — and not the per-second re-render that caused the shutter).

## Out of scope

Web UX polish (Memory tab, motion unification, anti-slop) is a **separate spec** (`2026-06-20-web-ux-polish-design.md`). It improves the web app and is inherited by this shell automatically.
