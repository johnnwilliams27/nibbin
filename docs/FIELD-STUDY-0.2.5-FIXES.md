# Field Study breakage — root causes, web fix, and the 0.2.5 native bundle

Investigation branch: `investigate/field-study` (off `main`). Reported on desktop **0.2.4**.

The desktop shell loads the live web app in the `grove` webview; the Field Study UI is
the web routes under `apps/web/app/app/study/**`, driven by an origin-locked Tauri IPC
bridge (`apps/web/lib/desktop/bridge.ts` → `apps/desktop/src-tauri/app/src/commands.rs`).
The capture daemon is `observerd` (Rust, `apps/desktop/src-tauri/observerd`).

Bottom line: the timer bugs and the *perceived* pause/stop failure were **one web-side
defect** (a wrong event name) plus a wrong formatter — both fixed in the PR. The
daemon-kept-watching report is a **native process-lifecycle bug** (uninstall/upgrade never
kills `observerd`), deferred to 0.2.5.

---

## Root cause per symptom

### 1 + 2. Timer static at `238:21:42`, and shown in hours not days

Two independent web-side defects, both in the study UI:

- **Static (never ticks):** the live-update listener subscribed to the **wrong Tauri event
  name**. The shell's countdown-refresher thread re-reads `daemon.status` once a second and
  emits it as **`study:status`**
  (`apps/desktop/src-tauri/app/src/lib.rs:265` — `handle.emit("study:status", &status)`),
  but the web bridge listened for **`study_state_change`**, which nothing emits
  (`apps/web/lib/desktop/bridge.ts`, `onStudyStateChange`). The callback therefore never
  fired: `remaining_ms` was set once by the mount-time `study_status` fetch and then frozen.
  There was also no client-side tick decrementing it locally.
- **Hours not days:** `formatCountdown` in `apps/web/app/app/study/page.tsx` (and a
  duplicate in `components/study/DesktopOrStudyCard.tsx`) bucketed the largest unit as
  **hours** (`${h}:${mm}:${ss}`). For a ~10-day remainder it produced `238:21:42`. The Rust
  tray tooltip already formatted days correctly (`{days}d {hours}h left`,
  `apps/desktop/src-tauri/app/src/lib.rs:291`) — only the web copy was wrong.

The remaining-time *source* is correct: the daemon computes `endsAt = startedAt + 14d`
(full study) and reports `remaining_ms` in `daemon.status`; the shell echoes it through
`study_status`. Nothing about the source needed fixing.

### 3 + 4. Pause and Stop-early "don't work"

The **web wiring is correct** and was verified end-to-end:

- Handlers call `desktopBridge.pause()` / `.stopEarly()`
  (`apps/web/app/app/study/page.tsx`), which invoke `send_control` with
  `{cmd:'pause'}` / `{cmd:'stop_early'}` (`apps/web/lib/desktop/bridge.ts`).
- `send_control` **is** granted by the capability set:
  `grove-remote.json` → `allow-send-control` → `permissions/bridge-read.toml`.
- The Rust handler `send_control` (`apps/desktop/src-tauri/app/src/commands.rs`) validates
  against `ALLOWED_CONTROL` (which includes `pause`, `resume`, `stop_early`) and appends
  `{"cmd":...}` to `control.jsonl`.
- The daemon drains `control.jsonl` and applies it: `pause` flips the capture gate
  (`nibbin-capture` atomic boolean, stops forwarding within ~100ms) and `stop_early`
  transitions the study to `Review` and stops the source.

So the control path itself works. Why did it *look* dead?

- **No UI feedback after the action.** Because the live event listener was bound to the
  wrong name (defect #1), the UI never received the post-pause/post-stop status push, so it
  never flipped to `Paused` / left the in-progress view. The action took effect in the
  daemon but the screen didn't move — indistinguishable from "nothing happened."
- The bridge `call()` wrapper **swallows errors and returns the fallback**
  (`apps/web/lib/desktop/bridge.ts`), so even a genuine failure would surface no feedback.

The same wrong-event-name fix that un-freezes the timer also makes pause/stop reflect
immediately. **No control-path change was needed or made on the web side.**

### 5. Daemon kept watching on a fresh 0.2.4 after deleting 0.2.3 (privacy crux)

In the **current source**, capture is correctly gated:
`capture_pass()` (`apps/desktop/src-tauri/observerd/src/lib.rs`) skips sampling unless
`capture_allowed(&study)` is true, i.e. study phase `Active` and not paused/expired. A
properly-driven daemon does **not** capture without an active, unpaused study.

The failure is **process lifecycle, not gate logic**:

- **Uninstall does not stop `observerd`.** `tauri.conf.json`'s `bundle.windows.nsis` block
  has **no `installerHooks`**, and there is **no `installer-hooks.nsh`** and **no
  `taskkill` anywhere** under `apps/desktop`. NSIS removes files but a running
  `observerd.exe` keeps executing in memory.
- **Upgrade-over-running leaves the old daemon alive.** Installing 0.2.4 while the 0.2.3
  daemon is running never kills the old process, so the orphaned 0.2.3 `observerd` keeps
  capturing under its older rules — exactly the reported "fresh 0.2.4 still watching."
- **The app never kills the daemon either.** It is spawned detached and, on
  `RunEvent::Exit`, only the tray icon is hidden — the daemon is left running by design (it
  is modeled as an always-on service), and on Windows it is also registered in
  `HKCU\...\CurrentVersion\Run`, which is never cleaned up on uninstall.

> Answers to the two crux questions:
> **(a) Does it capture without an active unpaused study?** Not in current source for a
> correctly-driven daemon — but an **orphaned older-version daemon** does, because nothing
> kills it. **(b) Does uninstall stop it?** **No.**

---

## Web vs native split

### Fixed in the PR (web — deploys to desktop immediately, no release)

- **Bridge event name:** `onStudyStateChange` now listens for `study:status` (the name the
  shell actually emits ~1×/sec). Un-freezes the countdown and makes pause/stop reflect
  immediately. `apps/web/lib/desktop/bridge.ts`.
- **Days-based countdown + client tick:** new shared, unit-tested helpers
  `apps/web/lib/study/countdown.ts` — `formatRemaining(ms)` ("9d 22h" / "3h 12m" / "4m 10s")
  and `extrapolateRemaining(base, baseAt, now)` (display-only local tick, anchored to the
  last daemon value, clamped ≥ 0, re-anchored on each push, runs only while `ACTIVE` so a
  paused study does not tick). Wired into both `app/app/study/page.tsx` and
  `components/study/DesktopOrStudyCard.tsx`, removing the duplicated hours-only formatter.
- **Tests:** `apps/web/lib/study/countdown.test.ts` (formatter + extrapolation, incl. the
  `238:21:42` regression) and two new cases in `apps/web/lib/desktop/bridge.test.ts`
  asserting the listener subscribes to `study:status` and forwards the payload.

The web control path (`send_control` + args + permission) was confirmed correct and left
unchanged.

### Deferred to 0.2.5 (native — daemon / Rust / NSIS)

- **NSIS uninstall hook** — add `installer-hooks.nsh` with
  `!macro NSIS_HOOK_PREUNINSTALL` (and/or `POSTUNINSTALL`) running
  `nsExec::Exec 'taskkill /F /IM observerd.exe'` before file removal, and wire it via
  `bundle.windows.nsis.installerHooks` in `tauri.conf.json`. (No such file/hook exists today.)
- **NSIS preinstall kill** — in the same hook file, `NSIS_HOOK_PREINSTALL` should
  `taskkill /F /IM observerd.exe` **before** laying down the new binary, so upgrading from a
  running 0.2.3/0.2.4 cannot leave the old daemon capturing. (This is what would have
  prevented the reported orphan.)
- **App-side lifecycle stop** — track the spawned `observerd` PID and kill it on
  `RunEvent::Exit` / window-destroyed in `apps/desktop/src-tauri/app/src/lib.rs`, so quitting
  Nibbin stops capture deterministically instead of relying on the daemon's own watchdog.
- **Remove the Windows autostart entry on uninstall** —
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\NibbinObserver` is registered by the
  daemon supervisor but never removed; clear it in the uninstall hook.
- **Daemon self-suspend watchdog (defense-in-depth)** — have `observerd` self-exit / suspend
  if there is no active study for N minutes, or if it detects the parent app is gone
  (heartbeat/lease file) or a newer daemon version is running. Bounds any future orphan even
  if a hook is missed. (Optionally re-read `study.json` on a timer so external deletion of
  the study is detected without a control message.)
- **(Optional) PID/heartbeat file** so the installer and app kill the *exact* running
  instance rather than a broad `/IM observerd.exe` match.

These are all Rust/NSIS/installer changes and must ship in the 0.2.5 native bundle.
