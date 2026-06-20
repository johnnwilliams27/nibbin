# Adversarial Gate — Daemon: remove_exclusion + field_notes v1

**Date:** 2026-06-20
**Branch:** `feat/daemon-exclusion-fieldnotes`
**Scope:** Implement the two daemon stubs — `remove_exclusion` (control handler + web re-enable) and `field_notes` v1 (local, derived per-app summaries from already-redacted events). Closes the gaps surfaced by the thin-shell gate.
**Sensitive paths:** `apps/desktop/src-tauri/` (daemon) + a NEW user-facing derived-data surface → gate mandatory.

## Verdict: PASS (after fixes)

| Reviewer (model) | Result |
|---|---|
| Red-team (opus) — field_notes raw-leak / egress crux | No P1; 1 P2 (fixed), 1 P3 (fixed) |
| Logic + cost (opus) | 1 P1 (fixed), 1 P2 (fixed), 2 P3 (fixed/resolved) |
| Claims-auditor (sonnet) | 2 P2 (fixed), 1 P3 (fixed) |

## Privacy crux (red-team + claims): CLEAN
`field_notes` derives notes from the **already-redacted** `ObserverEvent`s only — emitting app name + integer counts (windows, navs, file dialogs, key/click counts) + active duration + timestamp. It never reads window titles, AX labels, URLs, clipboard, or keystroke contents. **No network/LLM call** (C1 preserved). `field_notes.json` is written atomically to the store root, is local-only (never on the C7 packet path), and is removed by both `clear_store` and the C3 deletion verifier. Verified by both reviewers.

## Fixed before merge
- **P1 (cost)** — field_notes re-scanned the entire event store every 3 min (O(all events), grows over the 14-day study). Fixed: new `list_events_since(cutoff_iso)` (`WHERE ts >= ?1`); generation passes a 24h cutoff — bounds the scan and makes notes genuinely "the day's activity."
- **P2 (red-team)** — `RemoveExclusion` failed *open* on a corrupt `exclusions.json` (`unwrap_or_else` into the in-memory set). Now propagates the load error → sets `capture_blocked` + returns `Err` (fail-closed, matching `AddExclusion`).
- **P2 (logic)** — throttle used wall-clock; a backward clock jump could stall generation. Switched the throttle gate to monotonic `Instant::elapsed()`.
- **P2 (claims)** — stale `notes/page.tsx` comment (claimed daemon emits nothing) and **wrong help copy** (`content.ts` described total-event-count / pause-count / days-elapsed, which the daemon doesn't produce) — both corrected to describe the real per-app summaries.
- **P3s** — RemoveExclusion subtraction now case-insensitive (aligned with enforcement matching); stale `remove_exclusion` doc comment in `commands.rs` corrected; added a RemoveExclusion end-to-end test (add→blocked, remove→unblocked).

## Verification
`cargo fmt` clean; `nibbin-redaction` 9/9 tests pass; `npm run lint` clean; `tsc -p apps/web` no errors in changed files. Full `cargo test -p observerd` / `-p nibbin-store` validated by CI (the "Observer daemon" + "Desktop app crate" jobs) — the local OpenSSL/Strawberry-Perl toolchain can't build the screenpipe path.
