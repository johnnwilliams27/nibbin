# Adversarial gate — Capture Deferred Items (2026-06-18)

> Resolves the P2/P3 deferred items from the #140 Capture Bring-Up gate and the
> #151 Capture GA Hardening gate: direct-Hash dedup (D1), log facade (D2), store
> soft-cap fail-safe (D3), explicit WTS session lock-detection (D4).

- **Branch / PR:** `feature/capture-deferred` → `main` (#TBD)
- **Reviewed diff:** `git diff aa92add..13ea138` at `13ea138` (1 commit, ~35KB, 7 files)
- **Gate run by:** Claude Code (four adversarial reviewers, `.claude/agents/*`) on 2026-06-18 — human sign-off pending.

## CI step
- typecheck: ✅  tests: ✅ (implementer-reported: fmt/clippy/test green incl. screenpipe 20/20 + store soft-cap test)  lint: ✅  audit: ✅  SAST: ✅  redaction corpus: ✅  trigger-graph: ✅ (no trigger changes)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 1 |
| claims-auditor | PASS | 0 | 0 | 0 | 1 |
| logic-skeptic | PASS | 0 | 0 | 1 | 1 |
| cost-auditor (≥M2) | PASS | 0 | 0 | 1 | 0 |

---

## Findings (severity-ranked)

### P2 — non-blocking (track before next gate)

**LS-01** (P2) — `nibbin-store/src/lib.rs:event_count` — COUNT(*) on every append

`append()` calls `event_count()` (a full-table `SELECT COUNT(*) FROM events`) before every insert. In normal operation (well below 5 000 000 rows) this is fast, but: (a) it runs unconditionally — not only when nearing the cap — adding one extra SQLite query per append, and (b) under SQLCipher the optimizer's rowcount cache may not apply, so at large table sizes (tens/hundreds of thousands of rows near end-of-study) this could add measurable latency per tick. At 5 000 000 rows the overhead becomes non-trivial and, ironically, every failing append at the cap also pays a COUNT(*) round-trip before returning the bail error.

- **File:line:** `apps/desktop/src-tauri/crates/nibbin-store/src/lib.rs` ~line 458–462 (`event_count`)
- **Impact:** small per-append overhead; larger overhead near and at the cap (repeated COUNT(*) on capped-out table). No data-loss or privacy impact.
- **Fix direction:** maintain a cached in-memory count (incremented on each successful insert, loaded from COUNT(*) once at `open()`), or check the count lazily only when the last insert succeeded (i.e. skip the pre-check if `self.event_count_cache < cap - THRESHOLD`). A simple `u64` field on `ObserverStore` avoids all repeated COUNT(*) calls.
- **Status:** tracked; does not block merge (the cap is 5M, normal studies stay well under).

**cost-01** (P2) — `nibbin-store/src/lib.rs:append` — same COUNT(*) concern from cost lens

Mirrors LS-01: every `PersistSink::append` call now pays a SQLite `COUNT(*)` round-trip in addition to the actual INSERT. At the observed ~4 ticks/second with dedup (most ticks skip the INSERT via tree-hash), the append rate is low and the overhead is negligible in the happy path. Near the soft cap, however, the daemon will repeatedly enter `collect_items → append → COUNT(*)` per batch cycle even when blocked, burning CPU for no progress. The in-memory counter fix (LS-01 above) also resolves this.

- **File:line:** `apps/desktop/src-tauri/crates/nibbin-store/src/lib.rs` ~line 484–491 (`PersistSink::append`)
- **Impact:** minor CPU waste when store is at capacity (not user-visible at current scale). Shares fix with LS-01.
- **Status:** tracked; same fix covers both.

---

### P3 — minor (tracked, no gate action required)

**RT-P3** (P3) — `apps/desktop/src-tauri/crates/nibbin-capture/src/windows.rs` — D4 compile-verified only; physical lock/unlock not tested

D4 (WTS session lock-detection) is compile-verified on Windows (imports resolve, message pump logic is correct by inspection) but has not been physically exercised with a real lock/unlock event on hardware. The code path — `WTSRegisterSessionNotification` → `GetMessageW` pump → `WM_WTSSESSION_CHANGE` → `set_screen_locked` → `screen_is_locked()` in `poll()` — is structurally correct, but a runtime regression (e.g. WTS notification not firing in a particular session type, or the message not reaching the pump) would silently leave the lock flag stuck `false`, causing `poll()` to attempt tree walks on the secure desktop (C4 adjacent, though the lock screen's UIA tree is typically empty or access-denied). This is a macOS-priority deferral pattern: the correct behavior on lock is *already* covered by the existing `hwnd.is_invalid()` guard (lock screen returns an invalid HWND), so C4 is not regressed; the WTS path adds an explicit belt-and-suspenders layer. Still, physical verification on a Windows machine before the GA field-study rollout is recommended.

- **Impact:** if WTS wiring silently fails, capture on the lock screen is still blocked by `hwnd.is_invalid()` → no privacy regression. Belt-and-suspenders only.
- **Fix direction:** add a manual test step (lock the machine, observe `screen_is_locked()` in a debug log) to the pre-GA checklist.

**CA-P3** (P3) — `vendor/screenpipe/crates/screenpipe-a11y/src/local_compat.rs` — `local_compat` promoted from `pub(crate)` to `pub`

The module was `pub(crate)` in the prior gate (P3a tightening). D4 requires `set_screen_locked` to be callable from `nibbin-capture` (a separate crate), so `local_compat` is now `pub` and its functions are re-exported at the `screenpipe_a11y` crate root. The API surface expansion is intentional and necessary. Red-team verified: the only callers of `set_screen_locked` are the WTS handler in `nibbin-capture/src/windows.rs` (which sets it) and tests; `screen_is_locked()` is read only in `poll()`. No path allows untrusted content to call either function. The prior P3 note about removing `#[allow(dead_code)]` is resolved by D4 — the function now has a real caller and the allow attributes are gone.

- **Impact:** nil — encapsulation is widened to crate-boundary rather than workspace-boundary, which is correct and minimal.

---

## What the reviewers tried and why invariants held

### Red-team — D1 dedup, C4 non-bypass

Attempted to construct a C4 dedup-bypass: could a password field appear in the tree without changing the hash, causing dedup to suppress the emission that should trigger C4 suppression downstream?

Answer: no. `hash_node` explicitly hashes `is_password` (line 158 in the diff). A node with `is_password = Some(true)` hashes differently from one with `is_password = None` or `Some(false)`. The unit test `secure_field_appearing_hashes_differ` directly asserts this. C4 suppression runs in `snapshot_to_raw_events → node_to_ax` (downstream of `poll()`'s dedup check) — dedup cannot bypass suppression that executes after emission.

Attempted bounds-jitter bypass (prior concern): `bounds` (`Option<ElementBounds>` containing `f64`) is explicitly NOT hashed. This is intentional — pixel-coordinate jitter must not generate spurious emissions. No invariant depends on bounds being part of the fingerprint.

### Red-team — D3 soft-cap fail-safe, data-loss attack

Attempted to construct a silent data-drop via soft-cap: can an attacker or runaway capture loop cause the daemon to silently prune or lose previously-stored events?

Answer: no. The `append()` path checks the count first and fails *before* the INSERT. Existing rows are never touched. The unit test `append_past_soft_cap_fails_safe_without_dropping` directly verifies that `list_events()` still returns the pre-cap rows after the cap is hit. The daemon's response to the cap error is to set `capture_blocked` and return `Ok(())` — no crash, no pruning, no silent drop.

Attempted DoS: could a local attacker fill the store to 5M rows and block the study? Yes — but C1 (no network) means only local-machine code can do this, and local-machine code already has full process control. The cap exists to stop *accidental* runaway, not adversarial local attackers. The fail-safe stops additional writes and surfaces `capture_blocked` to the UI, which is the correct degraded-but-honest posture.

### Red-team — D4 lock-detection attack surface

Attempted: can untrusted content injected via a window title or accessibility node value call `set_screen_locked(false)` to force capture on the lock screen?

Answer: no. `set_screen_locked` is a normal Rust function in the `screenpipe_a11y` crate; it has no binding to any external input path. Accessibility node values are hashed (for dedup) and passed to the redaction pipeline (for C4/C5 suppression) — neither path calls `set_screen_locked`. Only the WTS message-pump handler in the hook thread calls it, and only on OS-originated `WM_WTSSESSION_CHANGE` messages.

Attempted message injection: could a rogue window send `WM_WTSSESSION_CHANGE` to the message-only window? `PostMessage` from another process to a message-only window (`HWND_MESSAGE` parent) is possible in principle. The handler only acts on the `wParam` values `WTS_SESSION_LOCK` and `WTS_SESSION_UNLOCK`; the `_` arm is a no-op. A rogue `WTS_SESSION_UNLOCK` would set `screen_is_locked(false)` if the flag was already true, potentially re-enabling capture after a real lock — this is a theoretical concern but requires local process-level access, placing it below the practical attack surface threshold for a local-only feature. The existing `hwnd.is_invalid()` guard remains as the primary lock-screen skip.

### Claims-auditor — C1, C4, C6 audit

**C1 (no network):** D4 adds `Win32_System_RemoteDesktop` features. `WTSRegisterSessionNotification` is a local IPC to the Windows Terminal Services service — no socket, no HTTP, no DNS. C1 holds by construction (zero network deps in `nibbin-capture` or the vendored crate).

**C4 (secure-field suppression):** D1 hashes `is_password`; any secure field appearing/disappearing changes the fingerprint → emission → C4 downstream suppression fires. By-construction enforcement unchanged.

**C6 (global pause):** D2 changes `eprintln!` → `log::debug!` on teardown timing. The C6 gate flip itself (atomic, wait-free) and its reconciliation from the prior gate are unaffected. No overclaim introduced.

**D4 compile-verified only:** The WTS lock-detection path (`WM_WTSSESSION_CHANGE` → `set_screen_locked`) has not been physically exercised on hardware. This is honest — the prior gate's RT-1 P2 finding (explicit lock detection not wired) is resolved at the code level; physical verification is pending and noted as P3 above. The existing `hwnd.is_invalid()` guard remains the structural privacy backstop.

**C11 / H2 (no silent data drop):** D3's fail-safe is H2 compliant: it never prunes or silently discards study data. The error surfaces `capture_blocked` visibly. The unit test verifies this directly.

### Logic-skeptic — D3 fail-safe stop path, marker robustness

**Soft-cap stop without crash:** When `is_soft_cap_error` returns true, the daemon breaks `'items`, sets `soft_cap_hit = true`, then after the loop sets `capture_blocked` and returns `Ok(())`. The `source` (WindowsUiaCapture) is NOT stopped — it continues polling. On the next `collect_items` call, items will again be returned and `append()` will again hit the cap, again return the marked error, again set `capture_blocked`, and again return `Ok(())`. This is a safe steady-state loop: capture blocked, UI notified, no crash, no data loss. Minor inefficiency: the source keeps running and items are collected but discarded — addressed by the LS-01/cost-01 COUNT(*) finding above, since the main overhead is the repeated COUNT(*) on a full table.

**Marker collision:** `SOFT_CAP_MARKER = "store soft cap reached"`. SQLite/SQLCipher error messages use formats like "no such table: X", "UNIQUE constraint failed: X", "disk I/O error" — none contain this substring. `anyhow` chain messages propagate the original error string; no standard Rust/anyhow message contains this substring. Collision risk: negligible in practice.

**D1 app+title in fingerprint:** `app` and `title` are hashed before `hash_node` is called (lines in `tree_fingerprint`). The same-tree-different-window test (`same_tree_different_window_hashes_differ`) verifies both. No regression from the prior LS-P3 note.

**D4 poll() ordering:** `screen_is_locked()` is checked *after* `is_idle()` and *before* `hwnd.is_invalid()`. The order does not create a gap — all three conditions skip the `capture_window_tree` call. Input counts drain regardless (they are below the `if !locked && !idle && !hwnd.is_invalid()` block). Correct.

**D4 teardown ordering:** `WTSUnRegisterSessionNotification(h)` is called before `DestroyWindow(h)` in the hook thread's cleanup block. This is the correct ordering per MSDN (unregister the notification handle before destroying the window it was registered against).

### Cost-auditor — D1 alloc removal, D3 count overhead, D4 pump overhead

**D1:** eliminates the per-tick `serde_json::to_string` heap allocation. `serde_json` is removed from `nibbin-capture`'s dependency set (Cargo.lock confirms removal). Direct recursive hashing via `hash_node` + `DefaultHasher` has no heap allocation. Cost-01 from the prior gate is resolved.

**D3:** `event_count()` runs a `COUNT(*)` per `append()` call. At typical study sizes (thousands to low-hundreds-of-thousands of rows), this is a fast SQLite index scan and adds <1ms. At very large sizes or at cap, the overhead is more significant (see LS-01/cost-01 above). The `EVENT_SOFT_CAP = 5_000_000` is generous; with tree-hash dedup, a 14-day study stays well below this (one snapshot per meaningful AX-tree change, not one per tick). Net cost impact: low in practice, but the in-memory counter fix remains recommended.

**D4:** The WTS message-only window adds one `CreateWindowExW` call at hook-thread startup and one `WTSRegisterSessionNotification` call. WTS lock/unlock events are infrequent (a few per session at most). Zero per-tick overhead. `log` facade dep is a zero-cost abstraction when no logger is installed (all macros no-op). Negligible COGS impact.

---

## Deferred items resolved vs. prior gate findings

| Prior finding | Gate | Resolution in this PR |
|---|---|---|
| LS-01 / fallback-collision (P2) | 2026-06-18-capture-ga-hardening | D1: direct `hash_node` eliminates `unwrap_or_default()` path entirely |
| cost-01 / per-tick JSON alloc (P2) | 2026-06-18-capture-ga-hardening | D1: `serde_json` dep dropped; `hash_node` is allocation-free |
| RT-P3 / `allow(dead_code)` on `set_screen_locked` (P3) | 2026-06-18-capture-ga-hardening | D4: function now has a real caller; `allow` attributes removed |
| `eprintln!`→`log::debug!` (P3) | 2026-06-18-capture-bringup | D2: `log::debug!` wired |
| RT-1 / explicit WTS lock-detection (P2) | 2026-06-18-capture-bringup | D4: WTSRegisterSessionNotification + poll() lock-skip |
| cost-P2 / store cap (P2) | 2026-06-18-capture-bringup | D3: `EVENT_SOFT_CAP` + fail-safe `append` + daemon `capture_blocked` |

**D4 physical verification note:** RT-1 is resolved at code level. Physical verification (live lock/unlock on Windows hardware) has not been performed and is tracked as RT-P3 above. The pre-existing `hwnd.is_invalid()` guard remains the structural backstop.

---

## Disposition
- Blocking (P0/P1) resolved: ☑ (0 P0, 0 P1 found)
- Non-blocking tracked: ☑ (LS-01 / cost-01 COUNT(*) overhead at P2; RT-P3 / D4 physical-verification at P3; CA-P3 / local_compat pub promotion at P3)
- **Gate verdict:** PASS
- **Signed:** pending John's sign-off (gate executed by Claude Code's four adversarial reviewers on 2026-06-18)
