# Adversarial gate — Capture GA Hardening (2026-06-18)

- **Branch / PR:** `feature/capture-ga-hardening` → `main` (#TBD)
- **Reviewed diff:** `git diff 83ce0dd..e567397` (2 commits; ~176 insertions, 17 deletions across 13 files)
- **Gate run by:** Claude Code (four adversarial reviewers, `.claude/agents/*`) on 2026-06-18 — human sign-off pending.
- **Scope:** GA P2 hardening of the #140 Capture Bring-Up pilot gate: H1 tree-hash dedup (windows.rs), H3 below-normal daemon process priority (observerd/main.rs + nibbin-capture/lib.rs), H6 input-baseline reset on resume (windows.rs + observerd/lib.rs), P3a local_compat pub(crate) tightening, P3b apply_pii inert-field doc, C6 / RT-2 comment reconciliation.

## CI step
- typecheck: ✅  tests: ✅ (implementer-reported; fmt/clippy/test green incl. screenpipe; 3 new H1 unit tests in tree_dedup_tests)  lint: ✅  audit: ✅  SAST: ✅  redaction corpus: ✅  trigger-graph: ✅ (no trigger changes in this diff)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 1 |
| claims-auditor | PASS | 0 | 0 | 0 | 1 |
| logic-skeptic | PASS | 0 | 0 | 1 | 1 |
| cost-auditor (≥M2) | PASS | 0 | 0 | 1 | 1 |

---

## Findings (severity-ranked)

### P2 — non-blocking (track before next gate)

**LS-01** (P2) — `nibbin-capture/src/windows.rs:tree_fingerprint` — silent serialization-failure dedup collision

`serde_json::to_string(root).unwrap_or_default()` silently falls back to `""` on serialization failure. If two consecutive ticks both fail to serialize the `AccessibilityNode` tree (both return `""`), the second tick's snapshot would be deduped away as a false-identical match even if the tree had changed. In practice `serde_json` does not fail on `#[derive(Serialize)]` types with no custom impl, so this is a very-unlikely path — but the silent fallback produces a wrong dedup decision rather than a conservative emit. A safer idiom would be `unwrap_or_else(|_| format!("{app}{title}"))` (incorporating app+title to avoid cross-call collision) or logging the serialization error and forcing emission. No privacy invariant is violated (C4 dedup bypass requires the fallback AND a tree change to coincide), but correctness is degraded in the error path.

- **File:line:** `apps/desktop/src-tauri/crates/nibbin-capture/src/windows.rs` ~line 304 (`serde_json::to_string(root).unwrap_or_default()`)
- **Impact:** dedup skips an emission it should not skip, causing a gap in the stored AX tree. No data leakage — the consequence is under-capture, not over-capture.
- **Fix direction:** replace `unwrap_or_default()` with a fallback that incorporates `app+title` (already hashed above) to avoid a colliding all-`""`-is-equal scenario, or log and force-emit on error.

**cost-01** (P2) — `nibbin-capture/src/windows.rs:tree_fingerprint` — per-tick full JSON serialization cost

Every tick where a foreground window is present (non-idle, valid HWND), `serde_json::to_string(root)` serializes the full `AccessibilityNode` tree (up to `MAX_ELEMENTS = 10_000` nodes) to a transient heap-allocated `String` that is immediately hashed and discarded. At ~4 ticks/second this is continuous JSON allocation even when the tree is stable. The dedup still wins over the pre-H1 baseline (no-dedup wrote the full tree to SQLCipher every tick), but there is a less costly alternative: implement `std::hash::Hash` directly on `AccessibilityNode` and its children (or use a streaming hasher like `FxHasher`/`AHasher` over the node fields), eliminating the full serialization allocation entirely.

- **File:line:** `apps/desktop/src-tauri/crates/nibbin-capture/src/windows.rs` ~line 304–306; `crates/nibbin-capture/Cargo.toml` (serde_json dep)
- **Impact:** unnecessary ~4x/s heap churn and JSON encoding on stable windows; measured on large trees this could account for a few ms/tick. On typical apps (hundreds of nodes) the impact is small but grows with window complexity.
- **Fix direction:** add `#[derive(Hash)]` to `AccessibilityNode` + recursively to all field types (or impl it manually using the structural fields), then replace the serde_json round-trip with a direct hasher call. The `serde_json` dep could then be dropped from `nibbin-capture` entirely. Not a blocker — the current approach is correct and the dedup benefit far exceeds the allocation cost at typical tree sizes.

---

### P3 — minor (tracked, no gate action required)

**RT-P3** (P3) — `vendor/screenpipe/crates/screenpipe-a11y/src/local_compat.rs` — `#[allow(dead_code)]` on `set_screen_locked`

The `allow(dead_code)` suppresses a lint on a function that has no caller in any non-test build (WTS lock-event wiring is gated elsewhere). The comment explains this correctly. Red-team attempted to exploit this as a hidden side-channel: does any path allow untrusted content to call `set_screen_locked(false)` and bypass the lock-screen capture skip? No — `local_compat` is now `pub(crate)` (P3a), so no external caller (including `nibbin-capture` which is a separate crate) can reach it. The function is dead from the outside by construction. Risk: nil. Tracking note: when WTS wiring lands, remove the `allow(dead_code)` to let the linter confirm the wiring is correct.

**CA-P3** (P3) — `docs/superpowers/specs/2026-06-17-capture-bringup-design.md` — RT-2 dormant-daemon posture documented in spec but acceptance is in the gate (not the spec directly)

The spec addition says "gate RT-2, decided 2026-06-18" inline. This is correct and traceable. Minor: the spec records the decision date but not the decision rationale (spawn-on-demand rejected because the daemon must already be running to receive Start). The rationale is in `daemon_supervisor.rs`'s new doc comment but not in the spec. Not a finding — just a note that future readers who only read the spec will not see the full reasoning.

**LS-P3** (P3) — `observerd/src/lib.rs:ControlCommand::Resume` — gate-before-source ordering

`self.gate.resume()` is called on line 565, then `self.source.resume()` on line 568. Between these two calls the daemon poll loop is not running (they are both within `drain_control`, which executes entirely before `capture_pass` runs). The ordering is therefore safe. However, if the daemon loop is ever refactored to run `capture_pass` concurrently, this ordering would allow a tick between gate-open and counter-rebaseline, producing one inflated InputBurst. Noting for awareness; not a current issue.

**cost-P3** (P3) — `serde_json` now an unconditional dep of the `screenpipe` feature but not of the default build

The Cargo.toml correctly gates `serde_json` under the `screenpipe` feature (`optional = true`). Cargo.lock shows it present because the reviewer build uses screenpipe. On default (non-screenpipe) builds it is absent. Correct and intentional.

---

## What the reviewers tried and why invariants held

**Red-team — C1/C4/C6 attack surface of H1 dedup:**
Attempted to construct a dedup bypass of C4 (secure-field suppression): could a password field appear in the tree without changing the hash? The answer is no — `AccessibilityNode` carries `is_password: bool` (and the `control_type` / `name` fields differ for `PasswordEdit` vs `Edit`); any change to these fields changes `serde_json::to_string(root)` → changes the u64 hash → the `self.last_tree_hash != Some(h)` check triggers emission. C4 suppression happens *after* emission in `parts_to_snapshot → node_to_ax`; dedup cannot bypass a suppression that runs downstream of it.

**Red-team — H3 priority change attack surface:**
`BELOW_NORMAL_PRIORITY_CLASS` is a scheduling priority for the observerd process. It has no effect on what the daemon captures, how it gates captures, or how it writes to the store. It does not widen any attack surface. No new system calls or capabilities are acquired.

**Claims-auditor — C6 reconciliation audit:**
Three locations carried the old "<100ms" claim: `gate.rs` module doc, `lib.rs` `PAUSE_SHORTCUT` comment, and the gate test comment. All three are updated. The new wording is consistent across all three: the gate flip itself is wait-free/sub-millisecond (tested by `pause_observed_under_100ms`); the end-to-end hotkey→capture-stop is ~250ms (daemon poll-bounded). The spec does not promise a number; the committed copy on `data-ai.html` / Privacy Policy was already number-free. No overclaim remains.

**Claims-auditor — RT-2 dormant-daemon posture:**
`daemon_supervisor::ensure_daemon_running` registers autostart on first launch. `capture_allowed` is false (enforced structurally in the daemon: the study gate is checked before any `capture_pass` output is forwarded) outside an active, consented study. The new doc comment accurately describes the posture. The accepted tradeoff (benign persistence vs spawn-on-demand complexity) is documented and traceable to the gate. No claim mismatch.

**Logic-skeptic — H6 underflow / counter ordering:**
`KEY_COUNT` and `CLICK_COUNT` are `AtomicU64` monotonic counters (they are only ever `fetch_add`'d). `self.last_keys` and `self.last_clicks` are set to the *current* values at resume. The next `poll()` computes `dk = keys_now - self.last_keys` as a u64 subtraction. Since both values are u64 and `keys_now >= self.last_keys` (monotonic + reset to current at resume), there is no underflow. The input accrued during the pause (which incremented `KEY_COUNT`/`CLICK_COUNT` while paused) is discarded by advancing the baseline past it. Correct.

**Cost-auditor — dedup cost vs write savings:**
Before H1: every tick wrote the full serialized AX tree to SQLCipher (~250ms cadence). After H1: every tick serializes to a transient `String` + u64 hash; writes are suppressed when the tree is unchanged. On a stable window (most of a typical user's session), this eliminates the vast majority of SQLCipher writes. The JSON allocation cost (~µs for typical trees) is negligible compared to a SQLCipher write (~ms). Dedup is a clear net positive on both CPU and I/O.

---

## Disposition
- Blocking (P0/P1) resolved: ☑ (0 P0, 0 P1 found — gate is additive to #140)
- Non-blocking tracked: ☑ (LS-01 and cost-01 at P2; RT-P3, CA-P3, LS-P3, cost-P3 at P3)
- **Gate verdict:** PASS
- **Signed:** pending John's sign-off (gate executed by Claude Code's four adversarial reviewers on 2026-06-18)
