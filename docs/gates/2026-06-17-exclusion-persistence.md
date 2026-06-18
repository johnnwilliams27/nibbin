# Adversarial gate — exclusion-persistence (2026-06-17)

- **Branch / PR:** `pr/exclusion-persistence` → `main` (#116)
- **Reviewed diff:** the 6 commits on the branch (durable exclusions store + fail-closed load/save), rebased onto current `main`.
- **Gate run by:** Claude Code (adversarial review subagent) on 2026-06-17

## CI step
- typecheck: ☑  tests (18: observerd + nibbin-redaction, incl. day14_headless + Rust corpus + restart/corruption proofs): ☑  lint (clippy): ☑  audit: ☑  SAST: ☑  redaction corpus: ☑  trigger-graph: n/a
- (cargo fmt failure fixed in this commit.)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | changes-requested → resolved | 0 | 1 | 1 | 0 |
| claims-auditor | pass | 0 | 0 | 0 | 0 |
| logic-skeptic | changes-requested → resolved | 0 | 1 | 0 | 0 |
| cost-auditor (≥M2) | pass | 0 | 0 | 0 | 0 |

## Findings (severity-ranked)
- **F1 — P1 (resolved) — save-on-add fail-open.** `apps/desktop/src-tauri/observerd/src/lib.rs` `handle(AddExclusion)` + `drain_control`: the control offset persisted *before* `handle`, so a `save_exclusions` failure was swallowed while the in-memory exclusion stayed live — it would silently evaporate on the next restart (a narrowed version of the very fail-open this feature closes). **Fix:** save-first ordering; on save failure set `capture_blocked` (capture suspended + surfaced in `daemon.status`), never enforce-then-lose. Committed `47ac9d3`. Test: `a_failed_exclusion_save_blocks_capture_instead_of_silently_enforcing`.
- **F2 — P2 (resolved) — corrupt-load operability.** Corrupt `exclusions.json` must fail *closed* but stay recoverable. **Fix:** daemon starts with `capture_blocked` set (capture suspended, reason surfaced) rather than refusing to boot; cleared by delete-everything. Test: `a_corrupt_exclusions_file_blocks_capture_but_keeps_daemon_alive`.
- **F3 — Minor (resolved) — stale `.tmp` residual.** A kill between write and rename could leave `exclusions.json.tmp`; added to the C3 residual-wipe list so a deletion receipt can't be failed by it.

Invariants verified: C1 (no network added), C3 (`exclusions.json` wiped in `delete_raw_and_verify`; `delete_everything` test green), C5 (blocklist matching unchanged), TC-P3 fail-closed.

## Disposition
- Blocking (P0/P1) resolved: ☑  Non-blocking tracked: ☑ (none open)
- **Gate verdict:** PASS
- **Signed:** John (pending) — gate report authored from the adversarial review; awaiting human sign-off on the PR.
