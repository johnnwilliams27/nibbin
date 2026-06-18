# Capture Bring-Up — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review (build is hardware-dependent — needs real macOS + Windows machines)
**Scope:** Turn the **staged** capture engine into **real OS capture** on macOS (M6) and Windows (M8), so the field study feeds **real diagnoses** instead of seeded fixtures. Three pieces, in dependency order: (1) **spawn the daemon** (the missing piece that makes the whole study reachable — today it dead-ends at `DAEMON_OFFLINE`); (2) wire the **macOS AX adapter** to the vendored Screenpipe a11y fork; (3) the **Windows UIA adapter** (parity pass). Plus permissions, the OS-level enforcement of C4/C6 that two latent claims depend on, resource budgets, and the seeded→live cutover.

**This spec designs only the capture engine + its lifecycle.** Everything downstream is already designed and built — see §2.

**Companion specs:**
- **Agent Synthesis** (`2026-06-17-agent-synthesis-design.md`) — the consumer. It is built/verified on **seeded diagnoses** until this lands (its §1, §15 "deferred-with-reason", §17). Real capture output flows through the *same* `ObserverEvent[]` → SQLCipher → segmentation path, so nothing downstream changes when fixtures swap for real (§9).
- **Trust & Controls** (`2026-06-17-trust-and-controls-design.md`) — §9 notes the two latent claims this spec lands: **C6 pause latency (#22)** and **C4 OS-flag suppression (#23)**; §8.1 the macOS menu-bar indicator parity; §5.1 exclusion persistence (already fixed, just reloaded before capture resumes). The `capture_blocked` daemon flag added there is the surface this spec uses to report permission/health failures.
- Field-study UX, consent, state machine, redaction, segmentation, cloud sync, diagnosis, quick-scan — all already specced (the `field-study-*`, `packet-enrichment`, `richer-diagnosis`, `finer-remining`, `adhoc-quick-scan` specs). **Not re-designed here.**

---

## 1. Goals & non-goals

**Goal:** A user on macOS (then Windows) can start a field study and have their *actual* work captured — accessibility-tree events + app/window/nav + input *counts* (the **Lite** mode; **Detailed** adds local frames + OCR, §5.0) — locally, redacted by the existing 4-layer pipeline, producing a real synthesis packet. The daemon runs reliably as an independent background process; permissions are requested and honored; nothing is captured silently without permission; the C4/C6 invariants are enforced at the OS level and measured on hardware.

**Non-goals (this spec):**
- The redaction pipeline, segmentation, packet build, cloud upload, diagnosis, mining, quick-scan, consent flow, study state machine, exclusion persistence, review-before-upload — **all already designed + built** (§2). Capture feeds them unchanged.
- The capability library / agent synthesis (the consumer; separate spec).
- Net-new event types beyond what the schema + vendored fork already support.
- Linux (the vendored fork has AT-SPI stubs; out of scope).

---

## 2. What already exists — DO NOT re-design (verified in code)

| Piece | Where | State |
|---|---|---|
| `CaptureSource` trait + `platform_source()` selector | `apps/desktop/src-tauri/crates/nibbin-capture/src/lib.rs:25-55` | **Works** — trait is clean; selects Mac/Windows/Mock |
| `MockCapture` (tests/CI) | `nibbin-capture/src/mock.rs` | **Works** |
| Study state machine + day-14 stop (C2) | `nibbin-study`; `observerd/tests/day14_headless.rs` | **Works** (headless-proven) |
| Pause gate (C6 mechanism) | `nibbin-capture/src/gate.rs` | **Works** (atomic bool; fast) |
| 4-layer fail-closed redaction + secure-field suppression mapping (C4) | `nibbin-redaction` (`pipeline.rs`, `capture_norm.rs`) | **Works** — consumes `AxSnapshot`, emits `ObserverEvent`; corpus-verified |
| Event schema (`EventKind`: Focus/AxDelta/Nav/InputBurst/FileDialog/ClipboardMeta), `AxSnapshot` shape | `nibbin-redaction/src/event.rs` | **Works** |
| `observerd` binary + capture loop (`drain_control → tick → capture_pass → write_status`) | `observerd/src/main.rs:31-42`, `lib.rs` | **Works headless** (`--once`/`--store` proven by tests) |
| Daemon status contract + cold-start poll | `app/src/commands.rs:39-56`, field-study UI `pollUntilOnline(3, 800)` | **Works** |
| `capture_blocked` health surface in `daemon.status` | `observerd/src/lib.rs:491-504` | **Works** (added in T&C exclusion fix) |
| **Vendored Screenpipe a11y fork** (MIT, frozen `892199f742`): macOS AX + Windows UIA primitives, permission checks, secure-field detection | `vendor/screenpipe/` (`platform/macos.rs` ~1870 LOC, `platform/windows_uia.rs` ~1500 LOC) | **Staged, not wired** — `screenpipe` cargo feature declared but never enabled |

The capture *architecture* is landed; what's missing is the OS wiring + the daemon's process lifecycle.

---

## 3. The gap — verified current state

1. **`MacAxCapture::start()` and `WindowsUiaCapture::start()` are honest stubs** that `anyhow::bail!("…requires the hardware bring-up pass…")` (`nibbin-capture/src/macos.rs:50-52`, `windows.rs:35`). Their TODO comments already enumerate the bring-up steps (AXObservers, `AXSecureTextField`→secure, CGEventTap counts, idle>90s suspend, <5% CPU/<300MB RSS; Windows UIA focus/structure/property, `UIA_IsPasswordPropertyId`→secure, secure-desktop no-capture, per-monitor DPI). They fail loud rather than record nothing — a deliberate invariant (P-CB1).
2. **The daemon is never spawned (the critical blocker, NIB-2/NIB-7).** There is **no** LaunchAgent plist (macOS), Windows service install, or spawn logic in `app/src/lib.rs`. The `observerd` binary works when run manually, but the app never starts it → `daemon.status` is absent → `read_status` returns `DAEMON_OFFLINE` (`commands.rs:43`) → the study can't leave `NOT_STARTED`. **A study can never run on a real machine until this is fixed**, regardless of capture wiring.
3. **The vendored fork's permission checks** (`vendor/screenpipe/platform/macos.rs:191-204` `check_permissions` → accessibility + input-monitoring) exist but are **not called** from the daemon.
4. **C6 latency (#22)** measured ~250ms vs the published <100ms; **C4 OS-flag suppression (#23)** is type-level only — both land here, on hardware.

---

## 4. Principles (capture-specific; inherit C1–C7, P2, P8)

- **P-CB1 — Fail loud, never record silently.** A capture source that cannot capture (no permission, fork error, secure desktop) **errors and sets `capture_blocked`** — it never returns empty while a study burns days believing it's recording. (Already the stubs' stance; keep it.)
- **P-CB2 — Permission-first.** No observer registers before the OS permission is granted; denial surfaces to the user (rehearsal UX, §5.9 of the field-study spec) via `capture_blocked`, never a silent dead study.
- **P-CB3 — Capture has no network (C1).** The capture process never opens a socket; the only egress anywhere is the user-initiated packet upload in the app (C7). Bring-up adds OS observers, not network.
- **P-CB4 — Secure by OS construction (C4).** Password/secure fields are suppressed by the **OS role** (`AXSecureTextField` / UIA `IsPassword`) → `secure=true` → `{SECURE}` + no frame — structurally, never by image/heuristic detection.
- **P-CB5 — The daemon is independent (load-bearing).** observerd runs as its own process so "kill the UI and every privacy invariant still holds" (C2/C3 in the daemon, not the UI). Bring-up must preserve this — the spawn mechanism keeps the daemon alive independent of the window, for the full 14 days.
- **P-CB6 — Budgeted (P8).** Idle >90s suspends observers; steady-state <5% CPU / <300MB RSS; verified on hardware, not assumed.

---

## 5. Architecture — three workstreams + two capture modes

### 5.0 Two capture modes — Lite (default) & Detailed (opt-in)
Depth is a **study attribute** (alongside the existing `kind: full_study | quick_scan` — add `depth: lite | detailed`), chosen at consent. Both modes share the **entire** downstream pipeline (AxSnapshot → redaction → `ObserverEvent` → segmentation → diagnosis); Detailed only *adds* signal into the same stream, so nothing downstream changes.
- **Lite (default, recommended — ships v1):** a11y tree + input-counts + URL/window/nav signal. Permissions: Accessibility + Input Monitoring. **No Screen Recording.** Rich for web/SaaS busywork + automatable creative-ops; lightest footprint; maximum privacy.
- **Detailed (opt-in — designed here, built phase 2):** Lite **plus** periodic screen frames + **local OCR**, for in-app depth in opaque/creative apps (Photoshop, Premiere, canvas/native). Permissions: additionally **Screen Recording**. New surface (the cost): OCR'd text is *content*, so it runs through the redaction pipeline before it can inform the packet; **frames never leave the device (C7)** — only redacted OCR-derived text can ride the synthesis packet, redaction-corpus-covered.
- **Honest by construction:** the chosen mode is stated plainly at consent — the user always knows whether screenshots are being taken. The depth is recorded on the study snapshot and surfaced in Trust & Controls.

**Choosing a mode — the entry/consent UX (new, must be built).** Most people shouldn't have to reason about accessibility trees, so the picker is framed by *what they want diagnosed*, with examples that map to a recommended mode. It **extends the existing `consentView`** (field-study spec) with a depth step:
- **Lite — best for admin & comms work** *(recommended for most)*: email & replies, scheduling, invoicing & chasing payments, CRM, data entry, spreadsheets, docs, project tracking, support. Tagline: *"Reads the structure of your work — no screenshots."*
- **Detailed — best for creative & visual work**: photo/video editing, design, illustration, motion, audio/music production — anywhere the work happens inside a canvas a structure-reader can't see. Tagline: *"Adds periodic screenshots, processed and deleted on your device, so Nibbin can see inside tools like Photoshop or Premiere."*
- **Mixed? Start Lite.** Even for creatives, most *automatable* busywork is the admin *around* the craft (client emails, exports, file org, posting, invoicing) — Lite captures that well; upgrade to Detailed later (a fresh study) if the diagnosis misses in-app work.

UX requirements: **Lite is the pre-selected, recommended default**; Detailed is a clearly-labeled opt-in that states its Screen-Recording permission + screenshot behavior up front (P-CB2, brand-voice). Use plain examples, not jargon ("admin work" / "creative work", not "a11y vs frames"). The chosen depth is visible throughout the study (tray tooltip + Field Notes) so it's never ambiguous what's being captured. Quick-scan and full-study both carry a depth.

### 5.1 Daemon lifecycle & spawn (the unblock — do this first)
The single highest-leverage fix: make the daemon **exist** on a real machine.
- **Bundle** the `observerd` binary with the Tauri app.
- **Register + start it** as an independent background process: **macOS LaunchAgent** (a `launchd` plist in `~/Library/LaunchAgents`, `RunAtLoad` + `KeepAlive`); **Windows** a per-user service or a Scheduled Task / autostart entry. (Process-model choice = **CB-D1**.)
- **Keep-alive / restart** on crash; the daemon is the source of truth for the 14-day clock, so it must survive app closure and reboots.
- **UI handoff:** the existing `read_status` + `daemon.status` contract + the `pollUntilOnline(3, 800)` cold-start poll already distinguish "starting" from "offline" — bring-up makes `DAEMON_OFFLINE` a *transient* startup state (daemon comes online) rather than a permanent dead-end. If the daemon truly can't start (e.g. install failed), surface it honestly (the field-study spec's daemon-health note), don't strand.

### 5.2 macOS AX adapter (M6)
Wire `MacAxCapture::start()` to the vendored fork (`vendor/screenpipe/platform/macos.rs`), enabling the `screenpipe` cargo feature:
1. **Permission gate first** (P-CB2): `ax::is_process_trusted()` (Accessibility) + `check_input_monitoring()`. Missing → set `capture_blocked` + trigger the §5.9 rehearsal; do not register observers.
2. **Register observers:** `AXObserver` (focus, value-changed, title-changed), `NSWorkspace` app-activation.
3. **Input counts only:** CGEventTap for keystroke/click **counts** (never content) → `InputBurst`.
4. **Secure fields (C4, P-CB4):** `AXSecureTextField` role → `AxSnapshotNode.secure = true`.
5. **Map to `AxSnapshot`** (the shape `nibbin-redaction` already consumes) and buffer for `poll()`.
6. **Idle/budget (P-CB6):** idle >90s suspends observers; enforce CPU/RSS budgets.

### 5.3 Windows UIA adapter (M8 — parity pass, after macOS proven)
Wire `WindowsUiaCapture::start()` to `vendor/screenpipe/platform/windows_uia.rs`:
1. `IUIAutomation` COM context + focus/structure/property event handlers + cached tree-walk.
2. `UIA_IsPasswordPropertyId` → `secure=true` (C4).
3. **Graceful no-capture on the secure desktop / UAC screens** (can't and shouldn't capture there).
4. Per-monitor DPI awareness (for any frame work).
5. Map to `AxSnapshot`; same idle/budget rules.

---

## 6. Permissions & rehearsal (P-CB2)
- **macOS:** Accessibility (`AXIsProcessTrusted`) + Input Monitoring (+ Screen Recording **only in Detailed mode**, §5.0). Checked on `start()`; denial → `capture_blocked="permission: accessibility"` (etc.) in `daemon.status` → the UI shows the **permission rehearsal** (field-study §5.9) with the OS grant deep-link, not a dead study.
- **Windows:** UIA needs no special grant for most apps, but **elevated/secure-desktop** windows are uncapturable — detect and skip (a visible gap, like a pause), never error the whole study.
- **Revocation mid-study:** if permission is revoked while running, `start`/`poll` detects it → `capture_blocked` + surface; the study pauses-with-reason rather than silently capturing nothing (P-CB1).

## 7. C4 / C6 enforcement landed here (the latent claims)
- **C4 (#23):** secure-field suppression is now real and OS-sourced (§5.2.4 / §5.3.2) — the T&C copy can move from "never via image detection" (true) to also truthfully describing OS-role suppression once verified.
- **C6 (#22):** measure pause latency **end-to-end on hardware** (gate flip → observers stop forwarding). Either hit a verified number or keep the T&C copy number-free. The gate mechanism is already fast; the unknown is observer teardown latency — measure it.

## 8. Resource budgets & verification (P-CB6)
Idle >90s → suspend observers (wake on activity). Steady-state target <5% CPU / <300MB RSS, measured on real hardware under a realistic workday. Frame work (if CB-D2 = yes) gets its own storage budget (SQLCipher blob sizing, `frame_ref` lifecycle). Exceeding budget → throttle/suspend + flag, never unbounded.

## 9. Seeded → live cutover (no downstream changes)
Capture output is `ObserverEvent[]` in the local SQLCipher store — **the exact input every downstream spec already assumes.** So: keep the seeded-fixture test path for downstream (segmentation/synthesis/diagnosis/agent) work; when the adapter goes live on hardware, real events land in the same store and flow through unchanged. **No segmentation/diagnosis/agent-synthesis spec changes** when fixtures swap for real — only the source of the events changes. This is what lets Agent Synthesis keep building on seeded diagnoses in parallel with this bring-up.

## 10. Unhappy paths (P5 / P-CB1)
Permission denied/revoked → `capture_blocked` + rehearsal, study pauses-with-reason, never silent. • Fork/observer crash → restart; repeated failure → `capture_blocked` + surface. • Secure desktop/UAC (Windows) → skip-with-visible-gap, not a study failure. • Daemon process dies → keep-alive restarts; if install is broken → honest `DAEMON_OFFLINE` + health note, never a silent stall. • Idle → suspend (not a gap that looks like data loss — it's an explicit capture_gap, per existing C6 gap logging). • Budget exceeded → throttle/suspend + flag. • Exclusions already reload before capture resumes (T&C §5.1) — bring-up must call that load before the first `capture_pass`.

## 11. Requirements coverage ledger
| # | Requirement | Section | Cross-ref |
|---|---|---|---|
| CB1 | **Spawn the daemon** as an independent background process (LaunchAgent/service), bundled binary, keep-alive — fixes the `DAEMON_OFFLINE` dead-end (NIB-2/7) | §5.1 | P-CB5 |
| CB2 | UI↔daemon handoff: `DAEMON_OFFLINE` becomes transient; honest health surface if install fails | §5.1 | existing status contract |
| CB3 | macOS AX adapter wired to the vendored fork (observers, activation, input counts) | §5.2 | C1 |
| CB4 | Windows UIA adapter (parity, after macOS) | §5.3 | C1 |
| CB5 | Permission gate + rehearsal; denial → `capture_blocked`, never silent | §6 | P-CB2, §5.9 |
| CB6 | C4 secure-field suppression by OS role (AXSecureTextField / UIA IsPassword) | §5.2/§5.3, §7 | C4, #23 |
| CB7 | C6 pause latency measured on hardware; reconcile the claim | §7 | C6, #22 |
| CB8 | Fail-loud: cannot-capture errors + flags, never records nothing silently | §4, §10 | P-CB1 |
| CB9 | Resource budgets (idle>90s suspend, <5% CPU/<300MB RSS), verified | §8 | P8, P-CB6 |
| CB10 | Map OS events → `AxSnapshot` (the existing redaction input); reuse the pipeline unchanged | §5.2/§5.3 | §2 |
| CB11 | Enable + integrate the vendored Screenpipe a11y fork (feature flag); track frozen-MIT provenance | §5.2, §2 | — |
| CB12 | Hardware verification pass: macOS menu-bar parity + permission flow + signed installers; Windows service lifecycle + UAC | §5, §6 | T&C §8.1, desktop-release |
| CB13 | Seeded→live cutover with zero downstream spec changes | §9 | AS seeded-diagnoses dep |
| CB14 | Unhappy paths first-class | §10 | P5 |
| CB15 | Two capture modes — `depth: lite \| detailed` study attribute; shared downstream pipeline; permission ask scales with mode | §5.0 | CB-D2 |
| CB16 | Detailed-mode OCR-text redaction surface — frames local-only (C7), only redacted OCR text informs the packet, redaction-corpus-covered | §5.0 | C7, R48 |
| CB17 | Mode-selection UX in the Field Study entry/consent — use-case-framed (admin→Lite / creative→Detailed) with examples + recommended Lite default; extends `consentView`; depth visible throughout the study | §5.0 | CB-D2, field-study consent |

**Deferred-with-reason:** Linux (vendored AT-SPI stubs only); net-new event kinds; **Detailed mode (frames + OCR) is designed (§5.0) but built phase 2, after Lite proves the bring-up on hardware.**

## 12. Open decisions
- **CB-D1 — DECIDED: independent daemon (LaunchAgent / Windows service).** observerd runs as its own background process so the 14-day study + every privacy invariant survive the UI closing (P-CB5). An app-spawned sidecar is acceptable **only** as a throwaway to unblock the first on-hardware capture test — never shipped.
- **CB-D2 — DECIDED: two capture modes (§5.0).** **Lite** (a11y + input-counts, default, no Screen Recording) ships in **v1**; **Detailed** (adds frames + local OCR, opt-in, requires Screen Recording) is **designed here, built phase 2**. This resolves depth-vs-privacy by making it the user's explicit consent-time choice rather than a product mandate — Lite nails SaaS/web busywork at the lightest footprint; Detailed adds in-app depth for opaque/creative tools at the cost of OCR-text redaction + the Screen-Recording permission. (If creative in-app depth becomes a launch requirement, Detailed moves up.)
- **CB-D3 — Windows timing.** **Rec: M8 (Windows) after macOS (M6) is proven on hardware** — prove the model once, then port.
- **CB-D4 — Hardware + signing dependency.** Bring-up needs a real Mac and Windows machine, and ties to the **signed-installer pipeline** (already live: Azure Trusted Signing + macOS signing per the desktop-release work). Not a fork — a sequencing/logistics note: the on-hardware pass can't be done from this environment.

## 13. Testing strategy
- Keep `MockCapture` + `day14_headless` for logic/state/redaction (no regression).
- **On-hardware (the bring-up pass):** real permission grant/deny → correct `capture_blocked`; an `AXSecureTextField`/password field never yields a value (C4 corpus check against live capture); pause flip measured (C6); a real short session produces a valid `ObserverEvent[]` that segments into a packet (end-to-end against the *existing* segmentation tests); idle>90s suspends; CPU/RSS within budget; daemon survives app close + reboot (CB1).
- **Cutover check:** a real captured session and a seeded fixture both produce valid packets through the *same* unchanged downstream path (§9).
